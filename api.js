/* Fetch Cursor plan usage using local IDE token + dashboard HTTP APIs (GJS). */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

Gio._promisify(
    Gio.Subprocess.prototype,
    'communicate_utf8_async',
    'communicate_utf8_finish',
);
Gio._promisify(
    Soup.Session.prototype,
    'send_and_read_async',
    'send_and_read_finish',
);

const API_BASE = 'https://api2.cursor.sh';

const STATE_DB_CANDIDATES = [
    [GLib.get_home_dir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'],
    [GLib.get_home_dir(), '.config', 'Cursor', 'Cursor', 'User', 'globalStorage', 'state.vscdb'],
];

function findStateDb() {
    for (const parts of STATE_DB_CANDIDATES) {
        const path = GLib.build_filenamev(parts);
        if (GLib.file_test(path, GLib.FileTest.IS_REGULAR))
            return path;
    }
    return null;
}

async function runSqlite(dbPath, sql, cancellable) {
    const sqlite = GLib.find_program_in_path('sqlite3');
    if (!sqlite)
        throw new Error('sqlite3 CLI not found');

    const proc = Gio.Subprocess.new(
        [sqlite, '-readonly', '-noheader', '-batch', dbPath, sql],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    const [, stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
    if (!proc.get_successful()) {
        const detail = (stderr || '').trim() || 'sqlite3 failed';
        throw new Error(detail);
    }
    return (stdout || '').replace(/\n$/, '');
}

async function readStateItem(key, cancellable) {
    const dbPath = findStateDb();
    if (!dbPath)
        return null;
    // Keys are fixed constants from this module only.
    const escaped = key.replaceAll("'", "''");
    const sql = `SELECT value FROM ItemTable WHERE key='${escaped}' LIMIT 1;`;
    const value = await runSqlite(dbPath, sql, cancellable);
    return value ? value.trim() : null;
}

function decoderText(bytes) {
    if (!bytes || bytes.get_size() === 0)
        return '';
    return new TextDecoder('utf-8').decode(bytes.toArray());
}

async function apiJson(session, token, method, path, cancellable) {
    const message = Soup.Message.new(method, `${API_BASE}${path}`);
    message.request_headers.append('Authorization', `Bearer ${token}`);
    message.request_headers.append('Accept', 'application/json');
    message.request_headers.append('User-Agent', 'CursorUsageGnomeExtension/1.0');
    if (method === 'POST') {
        message.request_headers.append('Content-Type', 'application/json');
        message.request_headers.append('Connect-Protocol-Version', '1');
        const body = new TextEncoder().encode('{}');
        message.set_request_body_from_bytes('application/json', GLib.Bytes.new(body));
    }

    const bytes = await session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        cancellable,
    );
    const status = message.get_status();
    const text = decoderText(bytes);
    if (status < 200 || status >= 300) {
        throw new Error(`HTTP ${status} on ${path}: ${text.slice(0, 200)}`);
    }
    if (!text)
        return {};
    return JSON.parse(text);
}

function msToIso(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const n = Number(value);
    if (Number.isNaN(n))
        return String(value);
    const seconds = n > 10_000_000_000 ? n / 1000 : n;
    return new Date(seconds * 1000).toISOString();
}

function centsToUsd(cents) {
    if (cents === null || cents === undefined)
        return null;
    const n = Number(cents);
    if (Number.isNaN(n))
        return null;
    return Math.round(n) / 100;
}

function pct(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    if (Number.isNaN(n))
        return null;
    return Math.round(n * 10) / 10;
}

/**
 * @returns {Promise<object>} usage snapshot (ok:true|false)
 */
export async function fetchUsageSnapshot(cancellable) {
    const dbPath = findStateDb();
    if (!dbPath) {
        return {
            ok: false,
            error: 'Cursor state database not found. Sign in to Cursor on this machine.',
        };
    }

    let token;
    try {
        token = await readStateItem('cursorAuth/accessToken', cancellable);
    } catch (e) {
        return {ok: false, error: e.message || String(e)};
    }
    if (!token) {
        return {
            ok: false,
            error: 'No Cursor access token in local state. Sign in to Cursor.',
        };
    }

    const cachedPlan = await readStateItem('cursorAuth/stripeMembershipType', cancellable);
    const cachedStatus = await readStateItem('cursorAuth/stripeSubscriptionStatus', cancellable);
    const cachedEmail = await readStateItem('cursorAuth/cachedEmail', cancellable);

    const session = new Soup.Session({timeout: 20});
    let usage;
    let plan;
    let profile = {};
    try {
        usage = await apiJson(
            session,
            token,
            'POST',
            '/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
            cancellable,
        );
        plan = await apiJson(
            session,
            token,
            'POST',
            '/aiserver.v1.DashboardService/GetPlanInfo',
            cancellable,
        );
        try {
            profile = await apiJson(
                session,
                token,
                'GET',
                '/auth/full_stripe_profile',
                cancellable,
            );
        } catch (_e) {
            profile = {};
        }
    } catch (e) {
        return {ok: false, error: e.message || String(e)};
    }

    const planInfo = plan.planInfo || {};
    const planUsage = usage.planUsage || {};
    const spendLimit = usage.spendLimitUsage || {};

    const membership =
        profile.membershipType ||
        profile.individualMembershipType ||
        cachedPlan ||
        planInfo.planName ||
        'unknown';
    const status = profile.subscriptionStatus || cachedStatus || 'unknown';
    const planName = planInfo.planName || membership;

    return {
        ok: true,
        fetchedAt: new Date().toISOString(),
        email: cachedEmail,
        plan: {
            name: planName,
            membershipType: membership,
            price: planInfo.price || null,
            status,
            isYearly: Boolean(profile.isYearlyPlan),
            isTeamMember: Boolean(profile.isTeamMember),
            pendingCancellationDate: msToIso(profile.pendingCancellationDate),
        },
        billingCycle: {
            start: msToIso(usage.billingCycleStart || planInfo.billingCycleStart),
            end: msToIso(usage.billingCycleEnd || planInfo.billingCycleEnd),
        },
        usage: {
            totalPercentUsed: pct(planUsage.totalPercentUsed),
            autoPercentUsed: pct(planUsage.autoPercentUsed),
            apiPercentUsed: pct(planUsage.apiPercentUsed),
            totalSpendUsd: centsToUsd(planUsage.totalSpend),
            includedSpendUsd: centsToUsd(planUsage.includedSpend),
            bonusSpendUsd: centsToUsd(planUsage.bonusSpend),
            limitUsd: centsToUsd(planUsage.limit),
            remainingBonus: planUsage.remainingBonus ?? null,
            bonusTooltip: planUsage.bonusTooltip || null,
            displayMessage: usage.displayMessage || null,
            autoMessage: usage.autoModelSelectedDisplayMessage || null,
            apiMessage: usage.namedModelSelectedDisplayMessage || null,
            enabled: usage.enabled ?? null,
            limitType: spendLimit.limitType || null,
        },
    };
}
