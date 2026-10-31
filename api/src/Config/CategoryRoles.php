<?php
declare(strict_types=1);

namespace FinHub\Config;

/**
 * Categorías con un papel especial en los cálculos de ingresos y gastos, identificadas por nombre.
 *  - Transferencia interna: traspasos entre cuentas propias, no son ni ingreso ni gasto.
 *  - Ingresos: un ingreso con esta categoría (o sin categoría) es un ingreso real; un ingreso con
 *    cualquier otra categoría es una devolución y resta del gasto de esa categoría.
 */
class CategoryRoles
{
    public const TRANSFER = 'transferencia interna';
    public const INCOME = 'ingresos';

    public static function roleOf(string $name): ?string
    {
        $key = mb_strtolower(trim($name));
        if ($key === self::TRANSFER) { return 'transfer'; }
        if ($key === self::INCOME) { return 'income'; }
        return null;
    }

    /**
     * Clasifica un movimiento de una cuenta corriente: 'expense', 'refund', 'income' o null (no cuenta).
     * $roles: [category_id => 'transfer'|'income'] de las categorías especiales.
     */
    public static function classify(string $type, ?int $categoryId, array $roles): ?string
    {
        if ($type !== 'income' && $type !== 'expense') { return null; }
        $role = $categoryId !== null ? ($roles[$categoryId] ?? null) : null;
        if ($role === 'transfer') { return null; }
        if ($type === 'expense') { return 'expense'; }
        return ($categoryId === null || $role === 'income') ? 'income' : 'refund';
    }
}
