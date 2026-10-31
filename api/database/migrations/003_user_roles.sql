-- FinHub: rol de usuario. El asistente de instalación crea el primer usuario como administrador.

ALTER TABLE `users` ADD COLUMN `role` ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER `password_hash`;
