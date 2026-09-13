"use strict";

// Local fork patch: reconcile stale/legacy WindowCovering services before the
// Tuya curtain accessory is exposed to HomeKit. Older plugin versions can leave
// an un-subtyped WindowCovering service in the cached PlatformAccessory. The
// current implementation looks up services by subtype (control/control_2), so it
// can otherwise add a second WindowCovering service and Apple Home presents the
// pair as e.g. "Gardin" and "Gardin 2".

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

    const claimed = new Set(this.__canonicalWindowCoveringServices.values());

    // Prefer the service created by current plugin versions. If it does not
    // exist, adopt one legacy WindowCovering service rather than creating a
    // duplicate. This also keeps two-channel curtains working: each channel
    // claims one distinct existing service before a new service is created.
    let service = this.accessory.getServiceById(this.Service.WindowCovering, subtype);

    if (!service) {
        const named = this.accessory.getService(subtype);
        if (named?.UUID === this.Service.WindowCovering.UUID && !claimed.has(named)) {
            service = named;
        }
    }

    if (!service) {
        service = this.accessory.services.find(candidate =>
            candidate.UUID === this.Service.WindowCovering.UUID && !claimed.has(candidate));
    }

    if (!service) {
        service = this.accessory.addService(this.Service.WindowCovering, defaultName, subtype);
    }

    this.__canonicalWindowCoveringServices.set(i, service);
    configureName(this, service, defaultName, { overrideName: defaultName });
    return service;
};

WindowCoveringAccessory.prototype.configureServices = function configureServicesPatched() {
    this.__canonicalWindowCoveringServices = new Map();

    // The original method configures handlers for one or two channels. Because
    // getServiceForIndex above adopts legacy services, all intended services are
    // now recorded in __canonicalWindowCoveringServices.
    originalConfigureServices.call(this);

    const keep = new Set(this.__canonicalWindowCoveringServices.values());
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
};

module.exports = WindowCoveringAccessory;
