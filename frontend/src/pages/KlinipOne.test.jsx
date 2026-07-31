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

function renderPage(props = {}) {
  return render(
    <KlinipOne
      user={user}
      healthProfiles={[profile]}
      activeProfileId={profile.id}
      {...props}
    />,
  );
}

async function reachMessageStep(interaction) {
  await interaction.click(
    screen.getByRole("button", { name: /Enviar mensaje/ }),
  );
  await waitFor(() => expect(api.getLinkedDevices).toHaveBeenCalled());
  await interaction.click(screen.getByRole("button", { name: "Continuar" }));
}

async function reachReview(interaction, { acknowledgement = true } = {}) {
  await reachMessageStep(interaction);
  await interaction.type(
    screen.getByPlaceholderText("Escribe aquí tu mensaje"),
    "Mensaje de prueba uno",
  );
  await interaction.click(screen.getByRole("button", { name: "Continuar" }));
  await interaction.click(
    screen.getByRole("radio", {
      name: acknowledgement
        ? /Sí, pedir confirmación/
        : /No, solo enviarlo/,
    }),
  );
  await interaction.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("Klinip One cloud UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLinkedDevices.mockResolvedValue([device]);
    api.getDeviceMessages.mockResolvedValue({ items: [] });
    api.getDevicePairing.mockResolvedValue({ status: "pending" });
    api.createDeviceMessage.mockResolvedValue({ recipient_count: 1 });
  });

  it("starts with only three large actions", async () => {
    renderPage();

    expect(
      screen.getByRole("button", { name: /Enviar mensaje/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Ver mensajes enviados/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Dispositivos vinculados/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Revocar mensaje")).not.toBeInTheDocument();
  });

  it("generates a temporary pairing code without exposing internal identifiers", async () => {
    const interaction = userEvent.setup();
    api.createDevicePairing.mockResolvedValue({
      pairing_id: "pair-secret-id",
      pairing_code: "ABCD1234",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      status: "pending",
    });
    renderPage();

    await interaction.click(
      screen.getByRole("button", { name: /Dispositivos vinculados/ }),
    );
    await interaction.click(
      screen.getByRole("button", { name: "Generar código" }),
    );

    expect(await screen.findByText("ABCD1234")).toBeInTheDocument();
    expect(screen.getByText(/El código dura 5 minutos/)).toBeInTheDocument();
    expect(screen.queryByText("pair-secret-id")).not.toBeInTheDocument();
  });

  it("sends to one selected device with confirmation", async () => {
    const interaction = userEvent.setup();
    const secondDevice = {
      ...device,
      device_id: "second-device",
      label: "Klinip One dormitorio",
    };
    api.getLinkedDevices.mockResolvedValue([device, secondDevice]);
    renderPage();

    await interaction.click(
      screen.getByRole("button", { name: /Enviar mensaje/ }),
    );
    await waitFor(() => expect(api.getLinkedDevices).toHaveBeenCalled());
    await interaction.selectOptions(
      screen.getByLabelText("Elegir dispositivo"),
      secondDevice.device_id,
    );
    await interaction.click(screen.getByRole("button", { name: "Continuar" }));
    await interaction.type(
      screen.getByPlaceholderText("Escribe aquí tu mensaje"),
      "Mensaje de prueba uno",
    );
    await interaction.click(screen.getByRole("button", { name: "Continuar" }));
    await interaction.click(
      screen.getByRole("radio", { name: /Sí, pedir confirmación/ }),
    );
    await interaction.click(screen.getByRole("button", { name: "Continuar" }));
    await interaction.click(
      screen.getByRole("button", { name: "Enviar mensaje" }),
    );

    expect(api.createDeviceMessage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        requires_acknowledgement: true,
        target_device_ids: ["second-device"],
      }),
      expect.any(String),
    );
  });

  it("sends without confirmation when the user chooses that option", async () => {
    const interaction = userEvent.setup();
    renderPage();
    await reachReview(interaction, { acknowledgement: false });

    await interaction.click(
      screen.getByRole("button", { name: "Enviar mensaje" }),
    );

    expect(api.createDeviceMessage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ requires_acknowledgement: false }),
      expect.any(String),
    );
  });

  it("uses one backend operation for all linked devices", async () => {
    const interaction = userEvent.setup();
    api.getLinkedDevices.mockResolvedValue([
      device,
      { ...device, device_id: "second-device", label: "Klinip One dormitorio" },
    ]);
    renderPage();
    await reachReview(interaction);

    await interaction.click(
      screen.getByRole("button", { name: "Enviar mensaje" }),
    );

    expect(api.createDeviceMessage).toHaveBeenCalledTimes(1);
    expect(api.createDeviceMessage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ target_device_ids: null }),
      expect.any(String),
    );
  });

  it("prevents accidental duplicate sends while a request is pending", async () => {
    let resolveSend;
    api.createDeviceMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    const interaction = userEvent.setup();
    renderPage();
    await reachReview(interaction);
    const send = screen.getByRole("button", { name: "Enviar mensaje" });

    await interaction.click(send);
    expect(send).toBeDisabled();
    await interaction.click(send);
    expect(api.createDeviceMessage).toHaveBeenCalledTimes(1);

    resolveSend({ recipient_count: 1 });
    expect(
      await screen.findByText("Mensaje enviado a Perfil ficticio."),
    ).toBeInTheDocument();
  });

  it.each([
    [
      { response: { data: { detail: "target_device_not_eligible" }, status: 404 } },
      "El dispositivo ya no está vinculado.",
    ],
    [
      { response: { data: { detail: "profile_not_authorized" }, status: 403 } },
      "No tienes permiso para realizar esta acción en este perfil.",
    ],
    [
      { response: { data: { detail: "invalid_message_body" }, status: 422 } },
      "El mensaje está vacío o es demasiado largo.",
    ],
    [{ request: {} }, "No se pudo conectar con Klinip. Inténtalo nuevamente."],
  ])("shows a useful safe send error", async (requestError, expectedMessage) => {
    api.createDeviceMessage.mockRejectedValue(requestError);
    const interaction = userEvent.setup();
    renderPage();
    await reachReview(interaction);

    await interaction.click(
      screen.getByRole("button", { name: "Enviar mensaje" }),
    );

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(screen.queryByText("dev-secret-id")).not.toBeInTheDocument();
  });

  it("shows a clear success response after sending", async () => {
    const interaction = userEvent.setup();
    renderPage();
    await reachReview(interaction);
    await interaction.click(
      screen.getByRole("button", { name: "Enviar mensaje" }),
    );

    expect(
      await screen.findByText("Mensaje enviado a Perfil ficticio."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Te avisaremos cuando Perfil ficticio lo confirme."),
    ).toBeInTheDocument();
  });

  it("keeps message activity and revocation inside the detail", async () => {
    api.getDeviceMessages.mockResolvedValue({
      items: [
        {
          message_id: "msg-secret-id",
          body: "Voy a visitarte en la tarde",
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
    renderPage();
    await interaction.click(
      screen.getByRole("button", { name: /Ver mensajes enviados/ }),
    );

    expect(
      await screen.findByText("Esperando confirmación"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Revocar mensaje")).not.toBeInTheDocument();
    await interaction.click(
      screen.getByRole("button", { name: "Ver detalle" }),
    );
    expect(screen.getByText("Revocar mensaje")).toBeInTheDocument();
    expect(screen.queryByText("heard")).not.toBeInTheDocument();
    expect(screen.queryByText("msg-secret-id")).not.toBeInTheDocument();
    expect(screen.queryByText("recipient-secret-id")).not.toBeInTheDocument();
  });

  it("shows an accessible empty permission state", async () => {
    render(
      <KlinipOne
        user={{ id: 99 }}
        healthProfiles={[profile]}
        activeProfileId={profile.id}
      />,
    );
    const interaction = userEvent.setup();
    await interaction.click(
      screen.getByRole("button", { name: /Dispositivos vinculados/ }),
    );

    expect(
      await screen.findByText("Sin perfiles disponibles"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No tienes permisos para vincular dispositivos."),
    ).toBeInTheDocument();
  });
});
