import * as httpApi from "./services/httpApi";

// API conectada siempre al backend real
const api = httpApi;

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

export const getMedications = api.getMedications;
export const saveMedication = api.saveMedication;
export const deleteMedication = api.deleteMedication;

export const subscribePush = api.subscribePush;
export const unsubscribePush = api.unsubscribePush;
export const sendTestPush = api.sendTestPush;
export const getLandingStats = api.getLandingStats;
