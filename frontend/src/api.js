import * as demoApi from "./services/demoApi";
import * as httpApi from "./services/httpApi";

// Cambia a false para usar el backend real
export const DEMO_MODE = false;

const api = DEMO_MODE ? demoApi : httpApi;

export const register = api.register;
export const login = api.login;
export const logout = api.logout;
export const getMe = api.getMe;

export const getAppointments = api.getAppointments;
export const createAppointment = api.createAppointment;
export const updateAppointment = api.updateAppointment;
export const deleteAppointment = api.deleteAppointment;

export const getDocuments = api.getDocuments;
export const uploadDocument = api.uploadDocument;
export const deleteDocument = api.deleteDocument;

// Medicamentos (solo demo por ahora)
export const getMedications = async () => {
  if (DEMO_MODE) {
    const { listMeds } = await import("./services/medsStorage");
    return listMeds();
  }
  return api.getMedications();
};

export const saveMedication = async (payload) => {
  if (DEMO_MODE) {
    const { saveMed } = await import("./services/medsStorage");
    return saveMed(payload);
  }
  return api.saveMedication(payload);
};

export const deleteMedication = async (id) => {
  if (DEMO_MODE) {
    const { deleteMed } = await import("./services/medsStorage");
    return deleteMed(id);
  }
  return api.deleteMedication(id);
};
