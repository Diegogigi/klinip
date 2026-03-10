export const PLAN_CATALOG = [
  {
    slug: "basico",
    name: "Básico",
    priceMonthly: "Gratis",
    priceYearly: "Gratis",
    yearlyEquivalent: "Sin costo",
    note: "Salud personal",
    summary: "Para organizar tu propia salud con lo esencial desde el primer día.",
    recommended: false,
    cta: "Empezar gratis",
    features: [
      "1 perfil de salud",
      "Medicamentos, citas y calendario",
      "Documentos médicos con OCR básico",
      "Recordatorios esenciales",
      "Acceso móvil y escritorio",
    ],
    detailSections: [
      {
        title: "Ideal para",
        items: [
          "Personas que quieren centralizar su información médica",
          "Usuarios que necesitan recordatorios y documentos en un solo lugar",
        ],
      },
      {
        title: "Incluye",
        items: [
          "Gestión de citas, medicamentos y documentos",
          "Historial básico de salud",
          "Panel individual simple y rápido",
        ],
      },
    ],
    metrics: [
      { label: "Perfiles", value: "1" },
      { label: "Colaboración", value: "No" },
      { label: "Panel familiar", value: "No" },
    ],
  },
  {
    slug: "plus",
    name: "Plus",
    priceMonthly: "$3.990 / mes",
    priceYearly: "$39.990 / año",
    yearlyEquivalent: "$3.332 / mes",
    note: "Individual ampliado",
    summary: "Más capacidad y seguimiento para quienes gestionan su salud y la de sus dependientes.",
    recommended: true,
    cta: "Probar Plus",
    features: [
      "Hasta 3 perfiles de salud",
      "OCR mejorado",
      "Historial completo y reportes",
      "Recordatorios avanzados",
      "Gestión personal y de dependientes",
    ],
    detailSections: [
      {
        title: "Ideal para",
        items: [
          "Usuarios que manejan su salud y la de hijos o adultos mayores",
          "Personas que necesitan más trazabilidad y reportes",
        ],
      },
      {
        title: "Incluye",
        items: [
          "Más perfiles para centralizar seguimiento",
          "Mayor profundidad en historial y documentos",
          "Automatización de recordatorios con más contexto",
        ],
      },
    ],
    metrics: [
      { label: "Perfiles", value: "3" },
      { label: "Colaboración", value: "Parcial" },
      { label: "Panel familiar", value: "No" },
    ],
  },
  {
    slug: "familiar",
    name: "Familiar",
    priceMonthly: "$6.990 / mes",
    priceYearly: "$69.990 / año",
    yearlyEquivalent: "$5.832 / mes",
    note: "Ecosistema colaborativo",
    summary: "Pensado para familias y cuidadores que coordinan la salud de varias personas.",
    recommended: false,
    cta: "Elegir Familiar",
    features: [
      "Hasta 5 perfiles de salud",
      "Panel familiar y calendarios compartidos",
      "Recordatorios por perfil",
      "Roles por cuidador y colaboración multiusuario",
      "Historial y actividad por persona",
    ],
    detailSections: [
      {
        title: "Ideal para",
        items: [
          "Familias que coordinan citas, medicamentos y documentos",
          "Cuidadores que necesitan visibilidad compartida",
        ],
      },
      {
        title: "Incluye",
        items: [
          "Panel familiar con contexto por integrante",
          "Colaboración entre cuidadores y responsables",
          "Seguimiento diferenciado por perfil y actividad",
        ],
      },
    ],
    metrics: [
      { label: "Perfiles", value: "5" },
      { label: "Colaboración", value: "Sí" },
      { label: "Panel familiar", value: "Sí" },
    ],
  },
];

export function getDefaultPlanSlug(catalog = PLAN_CATALOG) {
  return catalog.find((plan) => plan.recommended)?.slug || catalog[0]?.slug || "plus";
}

export function getPlanBySlug(slug, catalog = PLAN_CATALOG) {
  return catalog.find((plan) => plan.slug === slug) || null;
}
