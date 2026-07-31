import { describe, expect, it } from "vitest";
import {
  canManageDevices,
  canSendDeviceMessages,
  formatCountdown,
  getDeviceDisplayState,
  getMessageDisplayState,
  secondsUntil,
} from "./klinipOneUi";

describe("Klinip One presentation rules", () => {
  it("separates device and message permissions", () => {
    const profile = {
      owner_user_id: 7,
      access_status: "accepted",
      access_role: "caregiver",
      access_permissions: ["send_device_messages"],
    };

    expect(canSendDeviceMessages(profile, 8)).toBe(true);
    expect(canManageDevices(profile, 8)).toBe(false);
    expect(canManageDevices(profile, 7)).toBe(true);
  });

  it("presents heard and acknowledged as distinct states", () => {
    const base = {
      requires_acknowledgement: true,
      recipients: [{ current_state: "heard" }],
    };

    expect(getMessageDisplayState(base)).toBe("Esperando confirmación");
    expect(
      getMessageDisplayState({
        ...base,
        recipients: [{ current_state: "acknowledged" }],
      }),
    ).toBe("Confirmado");
  });

  it.each([
    ["queued", "Enviado"],
    ["delivered", "Entregado"],
    ["announced", "Entregado"],
    ["revoked", "No disponible"],
    ["expired", "No disponible"],
  ])("maps %s without exposing the internal state", (state, label) => {
    expect(
      getMessageDisplayState({
        recipients: [{ current_state: state }],
      }),
    ).toBe(label);
  });

  it("marks stale devices as offline and keeps revoked devices explicit", () => {
    const now = Date.parse("2026-07-30T12:00:00Z");
    expect(
      getDeviceDisplayState(
        { status: "active", last_seen_at: "2026-07-30T11:50:00Z" },
        now,
      ),
    ).toBe("Sin conexión");
    expect(getDeviceDisplayState({ status: "revoked" }, now)).toBe("Revocado");
  });

  it("keeps pairing countdown bounded at zero", () => {
    const now = Date.parse("2026-07-30T12:00:00Z");
    expect(secondsUntil("2026-07-30T12:01:05Z", now)).toBe(65);
    expect(formatCountdown(65)).toBe("1:05");
    expect(secondsUntil("2026-07-30T11:59:00Z", now)).toBe(0);
  });
});
