<?php
declare(strict_types=1);

namespace FinHub\Controllers;

use FinHub\Database\Database;
use FinHub\Utils\Response;
use PDO;

class CategoryController
{
    private PDO $db;
    private AuthController $authController;

    public function __construct()
    {
        $this->db = Database::getConnection();
        $this->authController = new AuthController();
    }

    /**
     * Obtener todas las supra categorías y categorías disponibles para el usuario
     * (tanto las base del sistema user_id IS NULL como las creadas por el usuario).
     * Listadas en orden alfabético.
     */
    public function getCategories(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        // 1. Obtener Supra Categorías (alfabético por nombre)
        $stmtSupra = $this->db->prepare('
            SELECT 
                s.id,
                s.user_id,
                s.name,
                s.color_hex,
                s.icon,
                s.created_at,
                (s.user_id IS NOT NULL) AS is_custom
            FROM supra_categories s
            WHERE s.user_id IS NULL OR s.user_id = :user_id
            ORDER BY s.name COLLATE utf8mb4_unicode_ci ASC
        ');
        $stmtSupra->execute(['user_id' => $userId]);
        $supraCategories = $stmtSupra->fetchAll();

        // 2. Obtener Categorías con su respectiva supra categoría (orden alfabético por nombre)
        $stmtCat = $this->db->prepare('
            SELECT 
                c.id,
                c.user_id,
                c.supra_category_id,
                s.name AS supra_category_name,
                s.color_hex AS supra_color_hex,
                c.name,
                c.color_hex,
                c.icon,
                c.is_active,
                c.created_at,
                (c.user_id IS NOT NULL) AS is_custom
            FROM categories c
            JOIN supra_categories s ON c.supra_category_id = s.id
            WHERE (c.user_id IS NULL OR c.user_id = :user_id) AND c.is_active = 1
            ORDER BY c.name COLLATE utf8mb4_unicode_ci ASC
        ');
        $stmtCat->execute(['user_id' => $userId]);
        $categories = $stmtCat->fetchAll();

        Response::success('Categorías obtenidas correctamente.', [
            'supra_categories' => $supraCategories,
            'categories' => $categories
        ]);
    }

    /**
     * Crear una nueva supra categoría personalizada
     */
    public function createSupraCategory(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $name = trim($input['name'] ?? '');
        $colorHex = trim($input['color_hex'] ?? '#6366f1');
        $icon = trim($input['icon'] ?? 'Folder');

        if ($name === '') {
            Response::error('El nombre de la supra categoría es obligatorio.', 422);
        }

        // Evitar duplicados para este usuario o globales
        $check = $this->db->prepare('
            SELECT id FROM supra_categories 
            WHERE LOWER(name) = LOWER(:name) AND (user_id IS NULL OR user_id = :user_id)
        ');
        $check->execute(['name' => $name, 'user_id' => $userId]);
        if ($check->fetch()) {
            Response::error("Ya existe una supra categoría con el nombre '{$name}'.", 409);
        }

        $stmt = $this->db->prepare('
            INSERT INTO supra_categories (user_id, name, color_hex, icon) 
            VALUES (:user_id, :name, :color_hex, :icon)
        ');
        $stmt->execute([
            'user_id' => $userId,
            'name' => $name,
            'color_hex' => $colorHex,
            'icon' => $icon
        ]);

        $id = (int)$this->db->lastInsertId();

        Response::success('Supra categoría creada exitosamente.', [
            'id' => $id,
            'user_id' => $userId,
            'name' => $name,
            'color_hex' => $colorHex,
            'icon' => $icon,
            'is_custom' => true
        ], 201);
    }

    /**
     * Crear una nueva categoría personalizada
     */
    public function createCategory(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $name = trim($input['name'] ?? '');
        $supraCategoryId = (int)($input['supra_category_id'] ?? 0);
        $colorHex = trim($input['color_hex'] ?? '#38bdf8');
        $icon = trim($input['icon'] ?? 'Tag');

        if ($name === '') {
            Response::error('El nombre de la categoría es obligatorio.', 422);
        }

        if ($supraCategoryId <= 0) {
            Response::error('Debe seleccionar una supra categoría válida.', 422);
        }

        // Validar que la supra categoría existe y es accesible por el usuario
        $supraCheck = $this->db->prepare('
            SELECT id, name FROM supra_categories 
            WHERE id = :id AND (user_id IS NULL OR user_id = :user_id)
        ');
        $supraCheck->execute(['id' => $supraCategoryId, 'user_id' => $userId]);
        $supra = $supraCheck->fetch();
        if (!$supra) {
            Response::error('La supra categoría indicada no existe o no tiene acceso a ella.', 404);
        }

        // Validar si ya existe una categoría con ese nombre para este usuario o base
        $check = $this->db->prepare('
            SELECT id FROM categories 
            WHERE LOWER(name) = LOWER(:name) AND (user_id IS NULL OR user_id = :user_id)
        ');
        $check->execute(['name' => $name, 'user_id' => $userId]);
        if ($check->fetch()) {
            Response::error("Ya existe una categoría con el nombre '{$name}'.", 409);
        }

        $stmt = $this->db->prepare('
            INSERT INTO categories (user_id, supra_category_id, name, color_hex, icon) 
            VALUES (:user_id, :supra_category_id, :name, :color_hex, :icon)
        ');
        $stmt->execute([
            'user_id' => $userId,
            'supra_category_id' => $supraCategoryId,
            'name' => $name,
            'color_hex' => $colorHex,
            'icon' => $icon
        ]);

        $id = (int)$this->db->lastInsertId();

        Response::success('Categoría creada exitosamente.', [
            'id' => $id,
            'user_id' => $userId,
            'supra_category_id' => $supraCategoryId,
            'supra_category_name' => $supra['name'],
            'name' => $name,
            'color_hex' => $colorHex,
            'icon' => $icon,
            'is_custom' => true
        ], 201);
    }

    /**
     * Modificar una categoría existente
     */
    public function updateCategory(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $name = trim($input['name'] ?? '');
        $supraCategoryId = (int)($input['supra_category_id'] ?? 0);
        $colorHex = trim($input['color_hex'] ?? '');
        $icon = trim($input['icon'] ?? '');

        // Obtener la categoría
        $stmt = $this->db->prepare('SELECT * FROM categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $category = $stmt->fetch();

        if (!$category) {
            Response::error('La categoría no existe.', 404);
        }

        // Si es personalizada, debe pertenecer al usuario
        if ($category['user_id'] !== null && (int)$category['user_id'] !== $userId) {
            Response::error('No tienes permiso para modificar esta categoría.', 403);
        }

        // Si es una categoría base (user_id IS NULL) pero el usuario quiere actualizar su asignación de supra o color,
        // o si es personalizada, permitimos modificar sus datos.
        $newName = $name !== '' ? $name : $category['name'];
        $newSupraId = $supraCategoryId > 0 ? $supraCategoryId : (int)$category['supra_category_id'];
        $newColor = $colorHex !== '' ? $colorHex : $category['color_hex'];
        $newIcon = $icon !== '' ? $icon : $category['icon'];

        // Validar supra
        $supraCheck = $this->db->prepare('
            SELECT id, name FROM supra_categories 
            WHERE id = :id AND (user_id IS NULL OR user_id = :user_id)
        ');
        $supraCheck->execute(['id' => $newSupraId, 'user_id' => $userId]);
        $supra = $supraCheck->fetch();
        if (!$supra) {
            Response::error('La supra categoría indicada no existe.', 404);
        }

        $upd = $this->db->prepare('
            UPDATE categories 
            SET name = :name, supra_category_id = :supra_category_id, color_hex = :color_hex, icon = :icon
            WHERE id = :id
        ');
        $upd->execute([
            'name' => $newName,
            'supra_category_id' => $newSupraId,
            'color_hex' => $newColor,
            'icon' => $newIcon,
            'id' => $id
        ]);

        Response::success('Categoría actualizada con éxito.', [
            'id' => $id,
            'name' => $newName,
            'supra_category_id' => $newSupraId,
            'supra_category_name' => $supra['name'],
            'color_hex' => $newColor,
            'icon' => $newIcon
        ]);
    }

    /**
     * Modificar una supra categoría existente
     */
    public function updateSupraCategory(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $name = trim($input['name'] ?? '');
        $colorHex = trim($input['color_hex'] ?? '');
        $icon = trim($input['icon'] ?? '');

        $stmt = $this->db->prepare('SELECT * FROM supra_categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $supra = $stmt->fetch();

        if (!$supra) {
            Response::error('La supra categoría no existe.', 404);
        }

        if ($supra['user_id'] !== null && (int)$supra['user_id'] !== $userId) {
            Response::error('No tienes permiso para modificar esta supra categoría.', 403);
        }

        $newName = $name !== '' ? $name : $supra['name'];
        $newColor = $colorHex !== '' ? $colorHex : $supra['color_hex'];
        $newIcon = $icon !== '' ? $icon : $supra['icon'];

        $upd = $this->db->prepare('
            UPDATE supra_categories 
            SET name = :name, color_hex = :color_hex, icon = :icon
            WHERE id = :id
        ');
        $upd->execute([
            'name' => $newName,
            'color_hex' => $newColor,
            'icon' => $newIcon,
            'id' => $id
        ]);

        Response::success('Supra categoría actualizada con éxito.', [
            'id' => $id,
            'name' => $newName,
            'color_hex' => $newColor,
            'icon' => $newIcon
        ]);
    }

    /**
     * Eliminar una categoría creada por el usuario
     */
    public function deleteCategory(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $stmt = $this->db->prepare('SELECT * FROM categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $category = $stmt->fetch();

        if (!$category) {
            Response::error('La categoría no existe.', 404);
        }

        if ($category['user_id'] === null) {
            Response::error('Las categorías base del sistema no pueden ser eliminadas.', 403);
        }

        if ((int)$category['user_id'] !== $userId) {
            Response::error('No tienes permisos para eliminar esta categoría.', 403);
        }

        $del = $this->db->prepare('DELETE FROM categories WHERE id = :id');
        $del->execute(['id' => $id]);

        Response::success('Categoría eliminada correctamente.');
    }

    /**
     * Listar las reglas automáticas de categorización del usuario (orden alfabético por concepto)
     */
    public function getRules(): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $stmt = $this->db->prepare('
            SELECT r.id, r.concept, r.category_id, c.name AS category_name, c.color_hex AS category_color, r.created_at
            FROM category_rules r
            JOIN categories c ON r.category_id = c.id
            WHERE r.user_id = :user_id
            ORDER BY r.concept COLLATE utf8mb4_unicode_ci ASC
        ');
        $stmt->execute(['user_id' => $userId]);

        Response::success('Reglas obtenidas correctamente.', ['rules' => $stmt->fetchAll()]);
    }

    /**
     * Editar el concepto o la categoría de una regla automática
     */
    public function updateRule(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $stmt = $this->db->prepare('SELECT id FROM category_rules WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => $id, 'user_id' => $userId]);
        if (!$stmt->fetch()) {
            Response::error('La regla no existe.', 404);
        }

        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $concept = trim((string)($input['concept'] ?? ''));
        $categoryId = (int)($input['category_id'] ?? 0);

        if (mb_strlen($concept) < 1 || mb_strlen($concept) > 255) {
            Response::error('El concepto es obligatorio (máx. 255 caracteres).', 422);
        }

        $catStmt = $this->db->prepare('SELECT 1 FROM categories WHERE id = :id AND (user_id IS NULL OR user_id = :user_id) AND is_active = 1');
        $catStmt->execute(['id' => $categoryId, 'user_id' => $userId]);
        if (!$catStmt->fetchColumn()) {
            Response::error('Categoría no válida.', 422);
        }

        $dupStmt = $this->db->prepare('SELECT 1 FROM category_rules WHERE user_id = :user_id AND concept = :concept AND id <> :id');
        $dupStmt->execute(['user_id' => $userId, 'concept' => $concept, 'id' => $id]);
        if ($dupStmt->fetchColumn()) {
            Response::error('Ya existe una regla para ese concepto.', 409);
        }

        $upd = $this->db->prepare('UPDATE category_rules SET concept = :concept, category_id = :category_id WHERE id = :id');
        $upd->execute(['concept' => $concept, 'category_id' => $categoryId, 'id' => $id]);

        Response::success('Regla actualizada correctamente.');
    }

    /**
     * Eliminar una regla automática
     */
    public function deleteRule(int $id): void
    {
        $user = $this->authController->authenticate();
        $userId = (int)$user['id'];

        $del = $this->db->prepare('DELETE FROM category_rules WHERE id = :id AND user_id = :user_id');
        $del->execute(['id' => $id, 'user_id' => $userId]);
        if ($del->rowCount() === 0) {
            Response::error('La regla no existe.', 404);
        }

        Response::success('Regla eliminada correctamente.');
    }
}
