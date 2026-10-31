-- FinHub: categorías del sistema (user_id NULL), compartidas por todos los usuarios.
-- «Ingresos» y «Transferencia interna» tienen un papel especial en los cálculos (ver Config/CategoryRoles.php).

INSERT IGNORE INTO `supra_categories` (`id`, `user_id`, `name`, `color_hex`, `icon`) VALUES
    (1, NULL, 'Alimentación', '#10b981', 'Utensils'),
    (2, NULL, 'Compras', '#ec4899', 'ShoppingBag'),
    (3, NULL, 'Deuda', '#ef4444', 'CreditCard'),
    (4, NULL, 'Impuestos', '#f97316', 'FileText'),
    (5, NULL, 'Ocio', '#8b5cf6', 'Sparkles'),
    (6, NULL, 'Restaurantes', '#f59e0b', 'Coffee'),
    (7, NULL, 'Ropa', '#06b6d4', 'Shirt'),
    (8, NULL, 'Suministros', '#3b82f6', 'Zap'),
    (9, NULL, 'Transporte', '#14b8a6', 'Car'),
    (10, NULL, 'Varios', '#64748b', 'Layers');

INSERT IGNORE INTO `categories` (`id`, `user_id`, `supra_category_id`, `name`, `color_hex`, `icon`) VALUES
    (1, NULL, 8, 'Agua', '#38bdf8', 'Droplet'),
    (2, NULL, 1, 'Comida', '#10b981', 'Apple'),
    (3, NULL, 8, 'Comunidad', '#6366f1', 'Building'),
    (4, NULL, 10, 'Efectivo', '#22c55e', 'Banknote'),
    (5, NULL, 8, 'Gas', '#f97316', 'Flame'),
    (6, NULL, 9, 'Gasolina', '#ea580c', 'Fuel'),
    (7, NULL, 4, 'Impuestos', '#e11d48', 'Receipt'),
    (8, NULL, 8, 'Luz', '#eab308', 'Zap'),
    (9, NULL, 2, 'Mascotas', '#a855f7', 'PawPrint'),
    (10, NULL, 5, 'Ocio', '#a855f7', 'Gamepad2'),
    (11, NULL, 10, 'ONG', '#ec4899', 'Heart'),
    (12, NULL, 3, 'Prestamos', '#ef4444', 'Landmark'),
    (13, NULL, 6, 'Restaurantes', '#f59e0b', 'UtensilsCrossed'),
    (14, NULL, 7, 'Ropa', '#06b6d4', 'Shirt'),
    (15, NULL, 10, 'Salud', '#14b8a6', 'Activity'),
    (16, NULL, 10, 'Seguros', '#0284c7', 'Shield'),
    (17, NULL, 8, 'Telefonía', '#8b5cf6', 'Phone'),
    (18, NULL, 9, 'Transporte', '#0d9488', 'Bus'),
    (19, NULL, 5, 'Vacaciones', '#38bdf8', 'Plane'),
    (20, NULL, 10, 'Varios', '#64748b', 'HelpCircle'),
    (21, NULL, 10, 'Vivienda', '#0ea5e9', 'Home'),
    (22, NULL, 10, 'Ingresos', '#22c55e', 'Banknote'),
    (23, NULL, 10, 'Transferencia interna', '#94a3b8', 'Folder');
