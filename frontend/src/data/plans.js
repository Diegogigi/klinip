export const PLAN_CATALOG = [
  {
    slug: "basico",
    name: "Básico",
    priceMonthly: "Gratis",
    priceYearly: "Gratis",
    yearlyEquivalent: "Sin costo",
    note: "Salud personal",
    summary: "Para organizar tu salud personal con lo esencial, acceso a Klinip IA en modalidad básica y un KlinipFeed personal privado.",
    recommended: false,
    cta: "Empezar gratis",
    features: [
      "1 perfil de salud",
      "Medicamentos, citas y calendario",
      "Documentos médicos con lectura automática básica",
      "Recordatorios esenciales",
      "Klinip IA básica con hasta 15 consultas al día",
      "KlinipFeed personal para actualizaciones privadas",
      "Acceso móvil y escritorio",
    ],
    detailSections: [
      {
        title: "Ideal para",
        items: [
          "Personas que quieren centralizar su información médica",
          "Usuarios que necesitan recordatorios, documentos y apoyo inicial de IA en un solo lugar",
        ],
      },
      {
        title: "Incluye",
        items: [
          "Gestión de citas, medicamentos y documentos",
          "Historial básico de salud",
          "Klinip IA con capacidad diaria limitada para consultas rápidas",
          "KlinipFeed personal para registrar avances desde tu cuenta",
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
    note: "Más perfiles + IA completa",
    summary: "Más capacidad de perfiles, Klinip IA completa y un KlinipFeed para seguir varias personas desde una sola cuenta.",
    recommended: true,
    cta: "Elegir Plus",
    features: [
      "Hasta 3 perfiles de salud",
      "Lectura automática mejorada de documentos",
      "Historial completo y reportes",
      "Recordatorios avanzados",
      "Klinip IA completa",
      "KlinipFeed para seguir hasta 3 perfiles desde tu cuenta",
      "Gestión individual de varios perfiles",
    ],
    detailSections: [
      {
        title: "Ideal para",
        items: [
          "Usuarios que manejan su salud y la de hijos, padres o dependientes desde su propia cuenta",
          "Personas que necesitan más trazabilidad y reportes",
        ],
      },
      {
        title: "Incluye",
        items: [
          "Hasta 3 perfiles sin colaboración multiusuario",
          "Mayor profundidad en historial y documentos",
          "Klinip IA completa para consultas, resúmenes y seguimiento",
          "KlinipFeed para compartir avances entre perfiles que administras",
        ],
      },
    ],
    metrics: [
      { label: "Perfiles", value: "3" },
      { label: "Colaboración", value: "No" },
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
    summary: "Pensado para familias y cuidadores que coordinan la salud de varias personas con Klinip IA completa, colaboración multiusuario y un KlinipFeed familiar compartido.",
    recommended: false,
    cta: "Elegir Familiar",
    features: [
      "Hasta 5 perfiles de salud",
      "Panel familiar y calendarios compartidos",
      "Recordatorios por perfil",
      "Roles por cuidador y colaboración multiusuario",
      "Klinip IA completa para todo el grupo",
      "KlinipFeed familiar compartido entre cuidadores y familia",
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
          "KlinipFeed familiar para publicar avances y novedades del grupo",
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
