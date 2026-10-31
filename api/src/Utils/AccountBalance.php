<?php
declare(strict_types=1);

namespace FinHub\Utils;

class AccountBalance
{
    /**
     * Saldo de una cuenta al final de un día, a partir de sus movimientos ordenados por fecha.
     * $acc necesita opening_date, balance e initial_balance; cada movimiento date, type, amount y balance_after.
     */
    public static function at(array $acc, array $txs, string $date): float
    {
        if ($acc['opening_date'] && $date < $acc['opening_date']) { return 0.0; }
        if (!$txs) { return (float)$acc['balance']; }

        $last = null;
        foreach ($txs as $tx) {
            if ($tx['date'] > $date) { break; }
            if ($tx['balance_after'] !== null) { $last = (float)$tx['balance_after']; }
        }
        if ($last !== null) { return $last; }

        // Antes del primer movimiento: el saldo previo a él, o el inicial si no se puede deducir
        $first = $txs[0];
        if ($first['type'] === 'update' || $first['balance_after'] === null) { return (float)$acc['initial_balance']; }
        $amount = abs((float)$first['amount']);
        return (float)$first['balance_after'] + ($first['type'] === 'income' ? -$amount : ($first['type'] === 'expense' ? $amount : 0));
    }
}
