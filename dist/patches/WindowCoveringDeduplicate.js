"use strict";

// Local fork patch: normalise Tuya WindowCovering services to the subtype layout
// expected by current plugin versions. Older cached accessories may contain an
// un-subtyped WindowCovering service. Reusing that service leaves the structural
// mismatch in place, so later code can legitimately add a subtype="control"
// service and Apple Home then exposes both as e.g. "Gardin" and "Gardin 2".
//
// This patch therefore creates/keeps only the canonical subtype services
// (control/control_2) and removes any legacy/surplus WindowCovering services.

const WindowCoveringAccessory = require("../shared/accessories/WindowCoveringAccessory").default;
const { configureName } = require("../shared/accessories/characteristic/Name");

const originalConfigureServices = WindowCoveringAccessory.prototype.configureServices;

WindowCoveringAccessory.prototype.getServiceForIndex = function getServiceForIndexPatched(i) {
    if (!this.__canonicalWindowCoveringServices) {
        this.__canonicalWindowCoveringServices = new Map();
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
    // un-subtyped service: doing so is what lets a second canonical service be
    // created later in the lifetime of the same accessory.
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

    // The original method configures one or two channels and now receives only
    // canonical subtype services from the patched getServiceForIndex().
    originalConfigureServices.call(this);
    this.cleanupWindowCoveringServices();

    // One delayed sanity pass catches any service recreated by late startup
    // reconciliation and makes the log diagnostic rather than silently leaving
    // another duplicate behind. The canonical subtype services themselves are
    // never removed.
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
