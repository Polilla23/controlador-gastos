type Seed = { name: string; color: string; icon: string; kind: string; nature?: string; parent?: string };

/** Seeded on first login. Entries with `parent` become subcategories of that category. */
export const DEFAULT_CATEGORIES: Seed[] = [
  // Expenses (parents)
  { name: "Comida y bebidas", color: "#EF4444", icon: "utensils", kind: "EXPENSE", nature: "NEED" },
  { name: "Vivienda", color: "#F59E0B", icon: "home", kind: "EXPENSE", nature: "MUST" },
  { name: "Transporte", color: "#3B82F6", icon: "car", kind: "EXPENSE", nature: "NEED" },
  { name: "Salud", color: "#EC4899", icon: "heart-pulse", kind: "EXPENSE", nature: "NEED" },
  { name: "Ocio y entretenimiento", color: "#10B981", icon: "gamepad-2", kind: "EXPENSE", nature: "WANT" },
  { name: "Compras", color: "#06B6D4", icon: "shopping-bag", kind: "EXPENSE", nature: "WANT" },
  { name: "Servicios", color: "#8B5CF6", icon: "zap", kind: "EXPENSE", nature: "MUST" },
  { name: "Educación", color: "#6366F1", icon: "graduation-cap", kind: "EXPENSE", nature: "NEED" },
  { name: "Deudas y préstamos", color: "#DC2626", icon: "landmark", kind: "EXPENSE", nature: "MUST" },
  { name: "Otros gastos", color: "#6B7280", icon: "circle-dot", kind: "EXPENSE", nature: "NEED" },
  // Expenses (subcategories)
  { name: "Supermercado", color: "#F87171", icon: "shopping-cart", kind: "EXPENSE", nature: "NEED", parent: "Comida y bebidas" },
  { name: "Restaurantes", color: "#FB923C", icon: "utensils", kind: "EXPENSE", nature: "WANT", parent: "Comida y bebidas" },
  { name: "Delivery", color: "#FBBF24", icon: "bike", kind: "EXPENSE", nature: "WANT", parent: "Comida y bebidas" },
  { name: "Alquiler", color: "#FBBF24", icon: "key", kind: "EXPENSE", nature: "MUST", parent: "Vivienda" },
  { name: "Expensas", color: "#F59E0B", icon: "building", kind: "EXPENSE", nature: "MUST", parent: "Vivienda" },
  { name: "Transporte público", color: "#60A5FA", icon: "bus", kind: "EXPENSE", nature: "NEED", parent: "Transporte" },
  { name: "Combustible", color: "#2563EB", icon: "fuel", kind: "EXPENSE", nature: "NEED", parent: "Transporte" },
  { name: "Taxi / apps", color: "#1D4ED8", icon: "car-taxi-front", kind: "EXPENSE", nature: "WANT", parent: "Transporte" },
  { name: "Luz", color: "#A78BFA", icon: "lightbulb", kind: "EXPENSE", nature: "MUST", parent: "Servicios" },
  { name: "Gas", color: "#C4B5FD", icon: "flame", kind: "EXPENSE", nature: "MUST", parent: "Servicios" },
  { name: "Internet", color: "#818CF8", icon: "wifi", kind: "EXPENSE", nature: "MUST", parent: "Servicios" },
  { name: "Suscripciones", color: "#A855F7", icon: "repeat", kind: "EXPENSE", nature: "WANT", parent: "Servicios" },
  { name: "Farmacia", color: "#F472B6", icon: "pill", kind: "EXPENSE", nature: "NEED", parent: "Salud" },
  { name: "Gimnasio", color: "#34D399", icon: "dumbbell", kind: "EXPENSE", nature: "WANT", parent: "Ocio y entretenimiento" },
  { name: "Ropa", color: "#22D3EE", icon: "shirt", kind: "EXPENSE", nature: "WANT", parent: "Compras" },
  { name: "Tarjeta de crédito", color: "#B91C1C", icon: "credit-card", kind: "EXPENSE", nature: "MUST", parent: "Deudas y préstamos" },
  // Income
  { name: "Sueldo", color: "#1A9D76", icon: "briefcase", kind: "INCOME" },
  { name: "Freelance", color: "#24C092", icon: "laptop", kind: "INCOME" },
  { name: "Inversiones", color: "#187D60", icon: "trending-up", kind: "INCOME" },
  { name: "Reintegros", color: "#0EA5E9", icon: "undo-2", kind: "INCOME" },
  { name: "Otros ingresos", color: "#6B7280", icon: "circle-plus", kind: "INCOME" },
];
