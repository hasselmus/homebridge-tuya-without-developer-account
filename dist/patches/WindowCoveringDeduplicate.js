"use strict";

// Local fork patch: normalise Tuya WindowCovering services to the subtype layout
// expected by current plugin versions and suppress a phantom second channel on
// single-channel curtains.
//
// homebridge-tuya-without-developer-account 1.0.56 defines channel 2 using
// fallbacks that include the generic `position` and `mach_operate` DPs. Its
// onDeviceStatusUpdate() iterates both channel descriptors unconditionally, so a
// one-channel curtain can later call getServiceForIndex(1) after a normal status
// update and create subtype="control_2". Apple Home then exposes "Gardin 2".
//
// A real second channel is recognised only by a genuinely channel-specific DP:
// `control_2` or `percent_control_2`. Without one of those, any accidental
// index-1 service request is mapped back to the canonical index-0 service.

const WindowCoveringAccessory = require("../shared/accessories/WindowCoveringAccessory").default;
const { configureName } = require("../shared/accessories/characteristic/Name");

const originalConfigureServices = WindowCoveringAccessory.prototype.configureServices;

WindowCoveringAccessory.prototype.hasRealSecondWindowCoveringChannel = function hasRealSecondWindowCoveringChannel() {
    return !!(this.getSchema('control_2') || this.getSchema('percent_control_2'));
};

WindowCoveringAccessory.prototype.getServiceForIndex = function getServiceForIndexPatched(i) {
    if (!this.__canonicalWindowCoveringServices) {
        this.__canonicalWindowCoveringServices = new Map();
    }

    // 1.0.56 can reach index 1 on a one-channel curtain because the second
    // schema descriptor falls back to the same generic `position` /
    // `mach_operate` DPs as channel 1. Do not allow that to manufacture a
    // second HomeKit WindowCovering service.
    if (i > 0 && !this.hasRealSecondWindowCoveringChannel()) {
        if (!this.__loggedPhantomSecondWindowCoveringChannel) {
            this.__loggedPhantomSecondWindowCoveringChannel = true;
            this.log.warn('Ignoring phantom second WindowCovering channel derived from generic Tuya DPs');
        }
        return this.getServiceForIndex(0);
    }

    const cached = this.__canonicalWindowCoveringServices.get(i);
    if (cached) {
        return cached;
    }

    const subtype = i === 0 ? 'control' : 'control_2';
    const defaultName = i === 0
        ? (this.device?.name || 'Window Covering')
        : `${this.device?.name || 'Window Covering'} ${i + 1}`;

    // Only a correctly subtyped service is canonical. Do not adopt an old
    // un-subtyped service: doing so lets another canonical service be created
    // later in the lifetime of the same accessory.
    let service = this.accessory.getServiceById(this.Service.WindowCovering, subtype);

    if (!service) {
        const legacyCount = this.accessory.services.filter(candidate =>
            candidate.UUID === this.Service.WindowCovering.UUID).length;
        if (legacyCount) {
            this.log.warn(`Creating canonical WindowCovering service subtype=${subtype}; ${legacyCount} legacy/surplus service(s) present`);
        }
        service = this.accessory.addService(this.Service.WindowCovering, defaultName, subtype);
    }

    this.__canonicalWindowCoveringServices.set(i, service);
    configureName(this, service, defaultName, { overrideName: defaultName });
    return service;
};

WindowCoveringAccessory.prototype.cleanupWindowCoveringServices = function cleanupWindowCoveringServicesPatched() {
    const keep = new Set(this.__canonicalWindowCoveringServices?.values() || []);
    let removed = false;

    for (const service of [...this.accessory.services]) {
        if (service.UUID !== this.Service.WindowCovering.UUID || keep.has(service)) {
            continue;
        }

        const label = service.displayName || service.subtype || 'unnamed';
        this.log.warn(`Removing stale duplicate WindowCovering service: ${label}`);
        this.accessory.removeService(service);
        removed = true;
    }

    if (removed) {
        try {
            this.platform.api.updatePlatformAccessories([this.accessory]);
        }
        catch (error) {
            this.log.warn(`Failed to persist WindowCovering service cleanup: ${error instanceof Error ? error.message : error}`);
        }
    }

    return removed;
};

WindowCoveringAccessory.prototype.configureServices = function configureServicesPatched() {
    this.__canonicalWindowCoveringServices = new Map();
    this.__loggedPhantomSecondWindowCoveringChannel = false;

    // The original method configures one or two channels and now receives only
    // canonical subtype services from the patched getServiceForIndex().
    originalConfigureServices.call(this);
    this.cleanupWindowCoveringServices();

    // One delayed sanity pass catches anything recreated during startup. Runtime
    // phantom-channel creation is prevented by getServiceForIndex() above.
    setTimeout(() => {
        try {
            this.cleanupWindowCoveringServices();
        }
        catch (error) {
            this.log.warn(`Delayed WindowCovering cleanup failed: ${error instanceof Error ? error.message : error}`);
        }
    }, 10000);
};

module.exports = WindowCoveringAccessory;
