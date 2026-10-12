/* Cursor Usage — top-bar panel indicator (GNOME Shell 49/50/51, ESM) */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {
    Extension,
    gettext as _,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {fetchUsageSnapshot} from './api.js';

const REFRESH_SECONDS = 300;
const INDICATOR_NAME = 'Cursor Usage';

function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
        return '—';
    return `${Math.round(Number(value))}%`;
}

function formatPercentPrecise(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
        return '—';
    return `${Number(value).toFixed(1)}%`;
}

function formatUsd(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
        return '—';
    return `$${Number(value).toFixed(2)}`;
}

function formatDate(iso) {
    if (!iso)
        return '—';
    try {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime()))
            return iso;
        return date.toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_e) {
        return iso;
    }
}

function titleCaseMembership(value) {
    if (!value)
        return '—';
    const map = {
        free: 'Free',
        pro: 'Pro',
        pro_plus: 'Pro+',
        ultra: 'Ultra',
        business: 'Business',
        enterprise: 'Enterprise',
        hobby: 'Hobby',
    };
    if (map[value])
        return map[value];
    return String(value)
        .split(/[_\s-]+/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function clampPercent(value) {
    const n = Number(value);
    if (Number.isNaN(n))
        return 0;
    return Math.max(0, Math.min(100, n));
}

function barFillClass(percent) {
    const n = Number(percent);
    if (!Number.isNaN(n) && n >= 100)
        return 'cursor-usage-bar-fill cursor-usage-bar-fill-full';
    if (!Number.isNaN(n) && n >= 90)
        return 'cursor-usage-bar-fill cursor-usage-bar-fill-high';
    return 'cursor-usage-bar-fill';
}

function statusKind(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'active' || s === 'trialing')
        return 'active';
    if (s === 'canceled' || s === 'cancelled' || s === 'past_due' || s === 'unpaid' || s === 'incomplete')
        return 'inactive';
    return 'unknown';
}

/** Original panel/menu mark (no third-party trademark artwork). */
function resolvePanelIconGicon(extensionPath) {
    const iconPath = GLib.build_filenamev([
        extensionPath,
        'icons',
        'panel-icon.svg',
    ]);
    if (GLib.file_test(iconPath, GLib.FileTest.EXISTS))
        return Gio.FileIcon.new(Gio.File.new_for_path(iconPath));
    return null;
}

const InfoSection = GObject.registerClass(
class InfoSection extends PopupMenu.PopupBaseMenuItem {
    _init(extension) {
        super._init({
            reactive: false,
            can_focus: false,
            style_class: 'cursor-usage-row',
        });
        this.setOrnament(PopupMenu.Ornament.HIDDEN);
        this._extension = extension;

        this.x_expand = true;
        this._root = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'cursor-usage-menu',
        });
        this.add_child(this._root);

        // Header: [logo + plan] (left) + status (right)
        this._header = new St.BoxLayout({
            style_class: 'cursor-usage-header',
            x_expand: true,
        });
        this._planBox = new St.BoxLayout({
            style_class: 'cursor-usage-plan-box',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._planIcon = new St.Icon({
            style_class: 'cursor-usage-menu-icon',
            icon_size: 18,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const menuGicon = resolvePanelIconGicon(extension.path);
        if (menuGicon)
            this._planIcon.gicon = menuGicon;
        else
            this._planIcon.icon_name = 'utilities-system-monitor-symbolic';

        this._planLabel = new St.Label({
            text: _('Loading…'),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            style_class: 'cursor-usage-plan',
        });
        this._planBox.add_child(this._planIcon);
        this._planBox.add_child(this._planLabel);

        this._statusBox = new St.BoxLayout({
            style_class: 'cursor-usage-status-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusDot = new St.Widget({
            style_class: 'cursor-usage-status-dot cursor-usage-status-dot-unknown',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusLabel = new St.Label({
            text: '—',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cursor-usage-status-text cursor-usage-status-text-unknown',
        });
        this._statusBox.add_child(this._statusDot);
        this._statusBox.add_child(this._statusLabel);
        this._header.add_child(this._planBox);
        this._header.add_child(this._statusBox);
        this._root.add_child(this._header);

        this._warnBanner = new St.Label({
            text: '',
            style_class: 'cursor-usage-warn-banner',
            visible: false,
        });
        this._warnBanner.clutter_text.line_wrap = true;
        this._root.add_child(this._warnBanner);

        // Usage / API bars
        this._bars = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'cursor-usage-bars',
        });
        this._usageBar = this._createBar(_('Usage'));
        this._apiBar = this._createBar(_('API'));
        this._bars.add_child(this._usageBar.box);
        this._bars.add_child(this._apiBar.box);
        this._root.add_child(this._bars);

        // Secondary details
        this._details = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'cursor-usage-details',
        });
        this._detailRows = {
            cycle: this._addDetailRow(_('Cycle ends')),
            spend: this._addDetailRow(_('Spend')),
            included: this._addDetailRow(_('Included')),
            bonus: this._addDetailRow(_('Bonus')),
            limit: this._addDetailRow(_('Plan limit')),
            price: this._addDetailRow(_('Price')),
            account: this._addDetailRow(_('Account')),
            updated: this._addDetailRow(_('Updated')),
        };
        this._root.add_child(this._details);
    }

    _createBar(title) {
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            style_class: 'cursor-usage-bar-block',
        });
        const header = new St.BoxLayout({
            style_class: 'cursor-usage-bar-header',
            x_expand: true,
        });
        const titleLabel = new St.Label({
            text: title,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cursor-usage-bar-title',
        });
        const pctLabel = new St.Label({
            text: '—',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cursor-usage-bar-pct',
        });
        header.add_child(titleLabel);
        header.add_child(pctLabel);

        const track = new St.Widget({
            style_class: 'cursor-usage-bar-track',
            x_expand: true,
            y_expand: false,
        });
        const fill = new St.Widget({
            style_class: 'cursor-usage-bar-fill',
            y_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        track.add_child(fill);
        track.connect('notify::allocation', () => {
            this._layoutBarFill(track, fill, box._cursorPercent || 0);
        });

        box.add_child(header);
        box.add_child(track);
        box._cursorPercent = 0;

        return {box, pctLabel, track, fill};
    }

    _layoutBarFill(track, fill, percent) {
        const width = Math.max(0, track.get_width());
        const fillWidth = Math.round(width * (clampPercent(percent) / 100));
        if (fill.get_width() !== fillWidth)
            fill.set_width(fillWidth);
    }

    _setBar(bar, percent) {
        bar.box._cursorPercent = Number(percent) || 0;
        bar.pctLabel.text = formatPercentPrecise(percent);
        bar.fill.style_class = barFillClass(percent);
        this._layoutBarFill(bar.track, bar.fill, percent);
    }

    _addDetailRow(key) {
        const row = new St.BoxLayout({
            style_class: 'cursor-usage-detail-row',
            x_expand: true,
        });
        const keyLabel = new St.Label({
            text: key,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cursor-usage-detail-key',
        });
        const valLabel = new St.Label({
            text: '—',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cursor-usage-detail-val',
        });
        row.add_child(keyLabel);
        row.add_child(valLabel);
        this._details.add_child(row);
        return valLabel;
    }

    setError(message) {
        this._planLabel.text = _('Error');
        this._setStatus('—', 'unknown');
        this._warnBanner.visible = true;
        this._warnBanner.text = message;
        this._setBar(this._usageBar, 0);
        this._setBar(this._apiBar, 0);
        this._usageBar.pctLabel.text = '—';
        this._apiBar.pctLabel.text = '—';
        for (const label of Object.values(this._detailRows))
            label.text = '—';
    }

    setData(data) {
        const usage = data.usage || {};
        const plan = data.plan || {};
        const cycle = data.billingCycle || {};

        const planLabel = plan.name || titleCaseMembership(plan.membershipType);
        this._planLabel.text = planLabel;
        this._setStatus(plan.status || '—', statusKind(plan.status));

        const total = Number(usage.totalPercentUsed);
        const showLimitWarn = !Number.isNaN(total) && total >= 100;
        this._warnBanner.visible = showLimitWarn;
        this._warnBanner.text = showLimitWarn
            ? (usage.displayMessage || _('You have reached your usage limit'))
            : '';

        this._setBar(this._usageBar, usage.totalPercentUsed);
        this._setBar(this._apiBar, usage.apiPercentUsed);

        this._detailRows.cycle.text = formatDate(cycle.end);
        this._detailRows.spend.text = formatUsd(usage.totalSpendUsd);
        this._detailRows.included.text = formatUsd(usage.includedSpendUsd);
        this._detailRows.bonus.text = formatUsd(usage.bonusSpendUsd);
        this._detailRows.limit.text = formatUsd(usage.limitUsd);
        this._detailRows.price.text = plan.price || '—';
        this._detailRows.account.text = data.email || '—';
        this._detailRows.updated.text = formatDate(data.fetchedAt);
    }

    _setStatus(text, kind) {
        this._statusLabel.text = text;
        let dotClass = 'cursor-usage-status-dot';
        let textClass = 'cursor-usage-status-text';
        if (kind === 'inactive') {
            dotClass += ' cursor-usage-status-dot-inactive';
            textClass += ' cursor-usage-status-text-inactive';
        } else if (kind === 'unknown') {
            dotClass += ' cursor-usage-status-dot-unknown';
            textClass += ' cursor-usage-status-text-unknown';
        }
        this._statusDot.style_class = dotClass;
        this._statusLabel.style_class = textClass;
    }
});

const CursorUsageIndicator = GObject.registerClass(
class CursorUsageIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, INDICATOR_NAME, false);
        this._extension = extension;
        this._refreshId = 0;
        this._fetchCancellable = null;
        this._data = null;

        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });

        this._icon = new St.Icon({
            style_class: 'system-status-icon cursor-usage-panel-icon',
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._setCursorIcon();
        box.add_child(this._icon);

        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'cursor-usage-label',
        });
        box.add_child(this._label);
        this.add_child(box);

        this._info = new InfoSection(this._extension);
        this.menu.addMenuItem(this._info);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh now'));
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        const openItem = new PopupMenu.PopupMenuItem(_('Open Cursor dashboard'));
        openItem.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri(
                'https://cursor.com/dashboard/usage',
                global.create_app_launch_context(0, -1),
            );
        });
        this.menu.addMenuItem(openItem);

        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._refresh();
        });

        this._scheduleRefresh(true);
    }

    _setCursorIcon() {
        const gicon = resolvePanelIconGicon(this._extension.path);
        if (gicon) {
            this._icon.gicon = gicon;
            this._icon.icon_size = 16;
            return;
        }
        this._icon.icon_name = 'utilities-system-monitor-symbolic';
    }

    _scheduleRefresh(immediate = false) {
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
        if (immediate)
            this._refresh();

        this._refreshId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_SECONDS,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    async _refresh() {
        if (this._fetchCancellable)
            this._fetchCancellable.cancel();

        const cancellable = new Gio.Cancellable();
        this._fetchCancellable = cancellable;

        try {
            const data = await fetchUsageSnapshot(cancellable);
            if (cancellable.is_cancelled())
                return;
            this._applyData(data);
        } catch (e) {
            if (cancellable.is_cancelled())
                return;
            this._applyError(e?.message || String(e));
        } finally {
            if (this._fetchCancellable === cancellable)
                this._fetchCancellable = null;
        }
    }

    _applyError(message) {
        this._data = null;
        this._label.text = '?';
        this._info.setError(message);
    }

    _applyData(data) {
        if (!data?.ok) {
            this._applyError(data?.error || _('Unknown error'));
            return;
        }

        this._data = data;
        const total = data.usage?.totalPercentUsed;
        this._label.text = formatPercent(total);
        this._info.setData(data);
    }

    destroy() {
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
        if (this._fetchCancellable) {
            this._fetchCancellable.cancel();
            this._fetchCancellable = null;
        }
        super.destroy();
    }
});

export default class CursorUsageExtension extends Extension {
    enable() {
        this._indicator = new CursorUsageIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
