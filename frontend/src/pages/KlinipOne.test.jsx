import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KlinipOne from "./KlinipOne";
import * as api from "../api";

vi.mock("../api", () => ({
  cancelDevicePairing: vi.fn(),
  createDeviceMessage: vi.fn(),
  createDevicePairing: vi.fn(),
  getDeviceMessages: vi.fn(),
  getDevicePairing: vi.fn(),
  getLinkedDevices: vi.fn(),
  revokeDeviceMessage: vi.fn(),
  revokeLinkedDevice: vi.fn(),
  updateLinkedDevice: vi.fn(),
}));

const user = { id: 1, name: "María" };
const profile = {
  id: 10,
  owner_user_id: 1,
  full_name: "Perfil ficticio",
  is_archived: false,
  access_permissions: [],
};
const device = {
  device_id: "dev-secret-id",
  label: "Klinip One hogar",
  status: "active",
  profile_id: 10,
  profile_display_name: "Perfil ficticio",
  created_at: "2026-07-30T10:00:00Z",
  last_seen_at: "2026-07-30T10:01:00Z",
};

describe("Klinip One cloud UI", () => {
  beforeEach(() => {
    api.getLinkedDevices.mockResolvedValue([]);
    api.getDeviceMessages.mockResolvedValue({ items: [] });
    api.getDevicePairing.mockResolvedValue({ status: "pending" });
  });

  it("generates a temporary pairing code without exposing internal identifiers", async () => {
    const interaction = userEvent.setup();
    api.createDevicePairing.mockResolvedValue({
      pairing_id: "pair-secret-id",
      pairing_code: "ABCD1234",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      status: "pending",
    });
    render(
      <KlinipOne
        user={user}
        healthProfiles={[profile]}
        activeProfileId={profile.id}
      />,
    );

    await interaction.click(
      screen.getByRole("button", { name: "Generar código" }),
    );

    expect(await screen.findByText("ABCD1234")).toBeInTheDocument();
    expect(screen.getByText(/El código dura 5 minutos/)).toBeInTheDocument();
    expect(screen.queryByText("pair-secret-id")).not.toBeInTheDocument();
    expect(api.createDevicePairing).toHaveBeenCalledWith(
      expect.objectContaining({
        health_profile_id: 10,
        expires_in_seconds: 300,
      }),
    );
  });

  it("renders human message states and never displays technical ids", async () => {
    api.getLinkedDevices.mockResolvedValue([device]);
    api.getDeviceMessages.mockResolvedValue({
      items: [
        {
          message_id: "msg-secret-id",
          body: "Voy a visitarte en la tarde",
          sender: { display_name: "María" },
          created_at: "2026-07-30T10:00:00Z",
          requires_acknowledgement: true,
          recipients: [
            {
              recipient_id: "recipient-secret-id",
              device_label: "Klinip One hogar",
              current_state: "heard",
            },
          ],
        },
      ],
    });
    const interaction = userEvent.setup();
    render(
      <KlinipOne
        user={user}
        healthProfiles={[profile]}
        activeProfileId={profile.id}
      />,
    );

    await interaction.click(screen.getByRole("tab", { name: "Mensajes" }));

    expect(
      await screen.findByText("Escuchado · Pendiente de confirmar"),
    ).toBeInTheDocument();
    expect(screen.queryByText("heard")).not.toBeInTheDocument();
    expect(screen.queryByText("msg-secret-id")).not.toBeInTheDocument();
    expect(screen.queryByText("recipient-secret-id")).not.toBeInTheDocument();
  });

  it("prevents accidental duplicate sends while a request is pending", async () => {
    let resolveSend;
    api.getLinkedDevices.mockResolvedValue([device]);
    api.createDeviceMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    const interaction = userEvent.setup();
    render(
      <KlinipOne
        user={user}
        healthProfiles={[profile]}
        activeProfileId={profile.id}
      />,
    );
    await waitFor(() => expect(api.getLinkedDevices).toHaveBeenCalled());
    await interaction.click(screen.getByRole("tab", { name: "Mensajes" }));
    await interaction.type(
      screen.getByPlaceholderText("Escribe un mensaje breve y familiar"),
      "Mensaje de prueba uno",
    );
    await interaction.click(
      screen.getByRole("button", { name: "Revisar y enviar" }),
    );
    const confirm = screen.getByRole("button", { name: "Enviar mensaje" });
    await interaction.click(confirm);

    expect(confirm).toBeDisabled();
    await interaction.click(confirm);
    expect(api.createDeviceMessage).toHaveBeenCalledTimes(1);

    resolveSend({});
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows an accessible empty permission state", async () => {
    render(<KlinipOne user={{ id: 99 }} healthProfiles={[profile]} />);

    expect(
      await screen.findByText("Sin perfiles disponibles"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No tienes permisos para vincular dispositivos."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "Secciones de Klinip One" }),
    ).toBeInTheDocument();
  });

  it("lets an authorized caregiver target all devices without listing them", async () => {
    const caregiverProfile = {
      ...profile,
      owner_user_id: 77,
      access_status: "accepted",
      access_role: "caregiver",
      access_permissions: ["send_device_messages"],
    };
    const interaction = userEvent.setup();
    render(
      <KlinipOne
        user={user}
        healthProfiles={[caregiverProfile]}
        activeProfileId={caregiverProfile.id}
      />,
    );

    await interaction.click(screen.getByRole("tab", { name: "Mensajes" }));

    expect(
      screen.getByRole("option", {
        name: "Todos los dispositivos autorizados",
      }),
    ).toBeInTheDocument();
    await interaction.type(
      screen.getByPlaceholderText("Escribe un mensaje breve y familiar"),
      "Voy a visitarte en la tarde",
    );
    expect(
      screen.getByRole("button", { name: "Revisar y enviar" }),
    ).toBeEnabled();
  });
});
