-- FinHub: esquema inicial (v1.0)

CREATE TABLE IF NOT EXISTS `users` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(191) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` ENUM('active', 'suspended', 'pending') NOT NULL DEFAULT 'active',
    `failed_login_attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `lockout_until` DATETIME NULL DEFAULT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_sessions` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL UNIQUE,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `expires_at` DATETIME NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    INDEX `idx_sessions_token` (`token_hash`),
    INDEX `idx_sessions_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `banks` (
    `id` VARCHAR(50) PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `logo_code` VARCHAR(50) NOT NULL,
    `color_hex` VARCHAR(20) NOT NULL DEFAULT '#38bdf8',
    `order_index` INT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `bank_id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `account_type` ENUM('checking', 'investment') NOT NULL DEFAULT 'checking',
    `balance` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `initial_balance` DECIMAL(15, 2) NOT NULL DEFAULT 0.00 COMMENT 'Saldo o capital aportado al abrir la cuenta',
    `iban` VARCHAR(34) NULL,
    `opening_date` DATE NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'EUR',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_accounts_bank` FOREIGN KEY (`bank_id`) REFERENCES `banks` (`id`) ON UPDATE CASCADE,
    INDEX `idx_accounts_user` (`user_id`),
    INDEX `idx_accounts_bank` (`bank_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `supra_categories` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NULL, -- NULL para supra categorías globales / base
    `name` VARCHAR(100) NOT NULL,
    `color_hex` VARCHAR(20) NOT NULL DEFAULT '#6366f1',
    `icon` VARCHAR(50) NOT NULL DEFAULT 'Folder',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_supra_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    INDEX `idx_supra_user` (`user_id`),
    INDEX `idx_supra_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `categories` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NULL, -- NULL para categorías del sistema / base
    `supra_category_id` INT UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `color_hex` VARCHAR(20) NOT NULL DEFAULT '#38bdf8',
    `icon` VARCHAR(50) NOT NULL DEFAULT 'Tag',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_categories_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_categories_supra` FOREIGN KEY (`supra_category_id`) REFERENCES `supra_categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX `idx_categories_user` (`user_id`),
    INDEX `idx_categories_supra` (`supra_category_id`),
    INDEX `idx_categories_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `transactions` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `account_id` INT UNSIGNED NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `date` DATE NOT NULL,
    `concept` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `type` ENUM('expense', 'income', 'update', 'internal') NOT NULL DEFAULT 'expense',
    `category_id` INT UNSIGNED NULL,
    `fund_id` INT UNSIGNED NULL COMMENT 'Fondo de una aportación o retirada; NULL = se reparte según los pesos',
    `balance_after` DECIMAL(15, 2) NULL COMMENT 'Saldo resultante tras la transacción',
    `notes` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_tx_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tx_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_tx_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX `idx_tx_account` (`account_id`),
    INDEX `idx_tx_user` (`user_id`),
    INDEX `idx_tx_date` (`date`),
    INDEX `idx_tx_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Reglas de categorización: transacciones con el mismo concepto se asignan a la categoría
CREATE TABLE IF NOT EXISTS `category_rules` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `concept` VARCHAR(255) NOT NULL,
    `category_id` INT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_rules_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_rules_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY `uq_rules_user_concept` (`user_id`, `concept`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proyección: ajustes del usuario (porcentajes anuales y años a proyectar)
CREATE TABLE IF NOT EXISTS `projection_settings` (
    `user_id` INT UNSIGNED PRIMARY KEY,
    `inflation` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `income_growth` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `investment_return` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `years` TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT 'Años a proyectar después del año en curso',
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_projset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proyección: celdas editadas a mano (importe neto del mes; negativo = gasto). category_id 0 = ingresos, -1 = sin categoría.
-- Una celda puntual no se arrastra a los años siguientes.
CREATE TABLE IF NOT EXISTS `projection_overrides` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `year` SMALLINT UNSIGNED NOT NULL,
    `month` TINYINT UNSIGNED NOT NULL,
    `category_id` INT NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `is_oneoff` TINYINT(1) NOT NULL DEFAULT 0,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_projover_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    UNIQUE KEY `uq_projover_cell` (`user_id`, `year`, `month`, `category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fondos indexados de cada cuenta de inversión. Las participaciones se calculan a partir de las aportaciones
-- y retiradas con el valor liquidativo de su fecha; el ancla (participaciones a una fecha) permite corregirlas.
CREATE TABLE IF NOT EXISTS `investment_funds` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `account_id` INT UNSIGNED NOT NULL,
    `isin` VARCHAR(12) NOT NULL,
    `symbol` VARCHAR(30) NOT NULL COMMENT 'Símbolo del proveedor de precios',
    `name` VARCHAR(160) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'EUR',
    `weight` DECIMAL(5, 2) NOT NULL DEFAULT 100.00 COMMENT '% de cada aportación sin fondo asignado',
    `anchor_units` DECIMAL(18, 6) NULL,
    `anchor_date` DATE NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `fk_funds_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_funds_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE,
    UNIQUE KEY `uq_funds_account_isin` (`account_id`, `isin`),
    INDEX `idx_funds_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Caché de valores liquidativos diarios, compartida entre usuarios
CREATE TABLE IF NOT EXISTS `fund_prices` (
    `symbol` VARCHAR(30) NOT NULL,
    `date` DATE NOT NULL,
    `nav` DECIMAL(18, 6) NOT NULL,
    PRIMARY KEY (`symbol`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Última descarga de precios de cada símbolo, para no consultar al proveedor en cada visita
CREATE TABLE IF NOT EXISTS `fund_price_syncs` (
    `symbol` VARCHAR(30) PRIMARY KEY,
    `fetched_at` DATETIME NOT NULL,
    `history_from` DATE NULL COMMENT 'Fecha más antigua descargada'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gastos previstos: se deducen de los gastos fijos del año anterior. Aquí solo se guardan los que el usuario desestima:
-- una cuota concreta (source_tx_id, el cargo del año anterior) o un concepto para siempre (concept_key).
CREATE TABLE IF NOT EXISTS `planned_dismissals` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT UNSIGNED NOT NULL,
    `source_tx_id` INT UNSIGNED NULL,
    `concept_key` VARCHAR(255) NULL,
    `label` VARCHAR(255) NOT NULL COMMENT 'Concepto mostrado, para poder restaurarlo',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_dismiss_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_dismiss_tx` FOREIGN KEY (`source_tx_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE,
    UNIQUE KEY `uq_dismiss_tx` (`user_id`, `source_tx_id`),
    UNIQUE KEY `uq_dismiss_concept` (`user_id`, `concept_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
