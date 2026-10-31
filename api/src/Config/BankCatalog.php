<?php
declare(strict_types=1);

namespace FinHub\Config;

/**
 * Catálogo hardcodeado de bancos oficiales admitidos en FinHub 2.0
 */
class BankCatalog
{
    public const BANKS = [
        'caixa_enginyers' => [
            'id' => 'caixa_enginyers',
            'name' => 'Caixa Enginyers',
            'short_name' => 'C. Enginyers',
            'color' => '#00838f',
            'accent' => '#00acc1',
            'group' => 'featured'
        ],
        'caixabank' => [
            'id' => 'caixabank',
            'name' => 'CaixaBank',
            'short_name' => 'CaixaBank',
            'color' => '#007eae',
            'accent' => '#00a3e0',
            'group' => 'featured'
        ],
        'kutxabank' => [
            'id' => 'kutxabank',
            'name' => 'Kutxabank',
            'short_name' => 'Kutxabank',
            'color' => '#e2001a',
            'accent' => '#ff3b30',
            'group' => 'featured'
        ],
        'indexa_capital' => [
            'id' => 'indexa_capital',
            'name' => 'Indexa Capital',
            'short_name' => 'Indexa',
            'color' => '#1e293b',
            'accent' => '#3b82f6',
            'group' => 'featured'
        ],
        'revolut' => [
            'id' => 'revolut',
            'name' => 'Revolut',
            'short_name' => 'Revolut',
            'color' => '#191c1f',
            'accent' => '#0075eb',
            'group' => 'featured'
        ],
        'banco_sabadell' => [
            'id' => 'banco_sabadell',
            'name' => 'Banco Sabadell',
            'short_name' => 'Sabadell',
            'color' => '#005596',
            'accent' => '#007acc',
            'group' => 'standard'
        ],
        'bbva' => [
            'id' => 'bbva',
            'name' => 'BBVA',
            'short_name' => 'BBVA',
            'color' => '#004481',
            'accent' => '#1464a5',
            'group' => 'standard'
        ],
        'ibercaja' => [
            'id' => 'ibercaja',
            'name' => 'Ibercaja',
            'short_name' => 'Ibercaja',
            'color' => '#b31b1b',
            'accent' => '#e53935',
            'group' => 'standard'
        ],
        'ing' => [
            'id' => 'ing',
            'name' => 'ING',
            'short_name' => 'ING',
            'color' => '#ff6200',
            'accent' => '#ff8c00',
            'group' => 'standard'
        ],
        'openbank' => [
            'id' => 'openbank',
            'name' => 'Openbank',
            'short_name' => 'Openbank',
            'color' => '#c00d0d',
            'accent' => '#e60000',
            'group' => 'standard'
        ],
        'myinvestor' => [
            'id' => 'myinvestor',
            'name' => 'Myinvestor',
            'short_name' => 'MyInvestor',
            'color' => '#2b2d42',
            'accent' => '#06d6a0',
            'group' => 'standard'
        ],
        'bankinter' => [
            'id' => 'bankinter',
            'name' => 'Bankinter',
            'short_name' => 'Bankinter',
            'color' => '#ff5900',
            'accent' => '#ff7920',
            'group' => 'standard'
        ],
        'unicaja' => [
            'id' => 'unicaja',
            'name' => 'Unicaja',
            'short_name' => 'Unicaja',
            'color' => '#00843d',
            'accent' => '#00a651',
            'group' => 'standard'
        ],
        'abanca' => [
            'id' => 'abanca',
            'name' => 'Abanca',
            'short_name' => 'Abanca',
            'color' => '#005494',
            'accent' => '#0083ca',
            'group' => 'standard'
        ],
        'banco_de_espana' => [
            'id' => 'banco_de_espana',
            'name' => 'Banco de España',
            'short_name' => 'B. España',
            'color' => '#374151',
            'accent' => '#4b5563',
            'group' => 'standard'
        ],
        'n26' => [
            'id' => 'n26',
            'name' => 'N26',
            'short_name' => 'N26',
            'color' => '#36a99a',
            'accent' => '#2cb5a0',
            'group' => 'standard'
        ],
    ];

    public static function getAll(): array
    {
        return array_values(self::BANKS);
    }

    public static function find(string $id): ?array
    {
        return self::BANKS[$id] ?? null;
    }
}
