<?php
declare(strict_types=1);

/**
 * FinHub API Entry Point
 */

// Error handling seguro para entorno API
ini_set('display_errors', '0');
error_reporting(E_ALL);

// Autoloader PSR-4 simple
spl_autoload_register(function ($class) {
    $prefix = 'FinHub\\';
    $baseDir = __DIR__ . '/src/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relativeClass = substr($class, $len);
    $file = $baseDir . str_replace('\\', '/', $relativeClass) . '.php';

    if (file_exists($file)) {
        require $file;
    }
});

use FinHub\Config\AppConfig;
use FinHub\Controllers\AuthController;
use FinHub\Controllers\InstallController;
use FinHub\Database\Database;
use FinHub\Database\Migrator;
use FinHub\Utils\Response;

$cors = AppConfig::get('cors');
date_default_timezone_set(AppConfig::get('app')['timezone'] ?? 'UTC');

// CORS solo para los orígenes configurados: lo normal es servir frontend y API desde el mismo sitio
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $cors['allowed_origins'], true)) {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: ' . implode(', ', $cors['allowed_methods']));
    header('Access-Control-Allow-Headers: ' . implode(', ', $cors['allowed_headers']));
}

// Cabeceras HTTP de endurecimiento de seguridad
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');

// Responder a preflight OPTIONS
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Ruta relativa a la carpeta de la API, esté donde esté instalada (/api, /finhub/api, raíz con php -S...)
$requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/');
if ($base !== '' && stripos($requestUri, $base) === 0) {
    $requestUri = substr($requestUri, strlen($base));
}
$path = '/' . trim($requestUri, '/');

// Enrutador básico y seguro
try {
    // Estado e instalación: disponibles sin instalar (el asistente se bloquea solo una vez instalado)
    if (str_starts_with($path, '/install') || $path === '/status') {
        $installController = new InstallController();
        if ($path === '/status' && $method === 'GET') {
            $installController->status();
        } elseif ($path === '/install/database' && $method === 'POST') {
            $installController->testDatabase();
        } elseif ($path === '/install' && $method === 'POST') {
            $installController->install();
        }
        Response::error("Ruta '{$path}' [{$method}] no encontrada.", 404);
    }

    if (!AppConfig::installed()) {
        Response::error('FinHub no está instalado.', 503, ['code' => 'not_installed']);
    }

    // Tras actualizar el código, la primera petición pone la base de datos al día
    $migrator = new Migrator(Database::getConnection());
    if ($migrator->pending()) {
        $migrator->migrate();
    }

    $authController = new AuthController();
    $accountController = new \FinHub\Controllers\AccountController();
    $categoryController = new \FinHub\Controllers\CategoryController();
    $transactionController = new \FinHub\Controllers\TransactionController();
    $dashboardController = new \FinHub\Controllers\DashboardController();
    $expenseController = new \FinHub\Controllers\ExpenseController();
    $balanceController = new \FinHub\Controllers\BalanceController();
    $projectionController = new \FinHub\Controllers\ProjectionController();
    $investmentController = new \FinHub\Controllers\InvestmentController();
    $fundController = new \FinHub\Controllers\FundController();
    $plannedController = new \FinHub\Controllers\PlannedExpenseController();

    if ($path === '/auth/register' && $method === 'POST') {
        $authController->register();
    } elseif ($path === '/auth/login' && $method === 'POST') {
        $authController->login();
    } elseif ($path === '/auth/me' && $method === 'GET') {
        $authController->me();
    } elseif ($path === '/auth/logout' && $method === 'POST') {
        $authController->logout();
    } elseif ($path === '/dashboard' && $method === 'GET') {
        $dashboardController->getSummary();
    } elseif ($path === '/planned-expenses/dismissals' && $method === 'POST') {
        $plannedController->dismiss();
    } elseif (preg_match('#^/planned-expenses/dismissals/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $plannedController->restore((int)$matches[1]);
    } elseif ($path === '/expenses' && $method === 'GET') {
        $expenseController->getExpenses();
    } elseif ($path === '/balance' && $method === 'GET') {
        $balanceController->getBalance();
    } elseif ($path === '/investments' && $method === 'GET') {
        $investmentController->getInvestments();
    } elseif ($path === '/investments/sync' && $method === 'POST') {
        $fundController->sync();
    } elseif (preg_match('#^/accounts/(\d+)/funds/rebuild$#', $path, $matches) && $method === 'POST') {
        $fundController->rebuildHistory((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)/funds$#', $path, $matches) && $method === 'POST') {
        $fundController->createFund((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)/funds/(\d+)$#', $path, $matches) && $method === 'PUT') {
        $fundController->updateFund((int)$matches[1], (int)$matches[2]);
    } elseif (preg_match('#^/accounts/(\d+)/funds/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $fundController->deleteFund((int)$matches[1], (int)$matches[2]);
    } elseif ($path === '/projection' && $method === 'GET') {
        $projectionController->getProjection();
    } elseif ($path === '/projection/settings' && $method === 'PUT') {
        $projectionController->updateSettings();
    } elseif ($path === '/projection/overrides' && $method === 'PUT') {
        $projectionController->saveOverride();
    } elseif ($path === '/projection/overrides' && $method === 'DELETE') {
        $projectionController->resetOverrides();
    } elseif ($path === '/banks' && $method === 'GET') {
        $accountController->getBanks();
    } elseif ($path === '/accounts' && $method === 'GET') {
        $accountController->getAccounts();
    } elseif ($path === '/accounts' && $method === 'POST') {
        $accountController->createAccount();
    } elseif (preg_match('#^/accounts/(\d+)$#', $path, $matches) && $method === 'PUT') {
        $accountController->updateAccount((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $accountController->deleteAccount((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)/transactions$#', $path, $matches) && $method === 'GET') {
        $transactionController->getTransactions((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)/transactions$#', $path, $matches) && $method === 'POST') {
        $transactionController->createTransaction((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)/transactions/import$#', $path, $matches) && $method === 'POST') {
        $transactionController->importTransactions((int)$matches[1]);
    } elseif (preg_match('#^/accounts/(\d+)/transactions/(\d+)/category$#', $path, $matches) && $method === 'PUT') {
        $transactionController->updateTransactionCategory((int)$matches[1], (int)$matches[2]);
    } elseif (preg_match('#^/accounts/(\d+)/transactions/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $transactionController->deleteTransaction((int)$matches[1], (int)$matches[2]);
    } elseif ($path === '/categories' && $method === 'GET') {
        $categoryController->getCategories();
    } elseif ($path === '/categories' && $method === 'POST') {
        $categoryController->createCategory();
    } elseif (preg_match('#^/categories/(\d+)$#', $path, $matches) && $method === 'PUT') {
        $categoryController->updateCategory((int)$matches[1]);
    } elseif (preg_match('#^/categories/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $categoryController->deleteCategory((int)$matches[1]);
    } elseif ($path === '/category-rules' && $method === 'GET') {
        $categoryController->getRules();
    } elseif (preg_match('#^/category-rules/(\d+)$#', $path, $matches) && $method === 'PUT') {
        $categoryController->updateRule((int)$matches[1]);
    } elseif (preg_match('#^/category-rules/(\d+)$#', $path, $matches) && $method === 'DELETE') {
        $categoryController->deleteRule((int)$matches[1]);
    } elseif ($path === '/supra-categories' && $method === 'POST') {
        $categoryController->createSupraCategory();
    } elseif (preg_match('#^/supra-categories/(\d+)$#', $path, $matches) && $method === 'PUT') {
        $categoryController->updateSupraCategory((int)$matches[1]);
    } elseif ($path === '' || $path === '/') {
        Response::success('FinHub API', ['status' => 'operational', 'version' => InstallController::VERSION]);
    } else {
        Response::error("Ruta '{$path}' [{$method}] no encontrada.", 404);
    }
} catch (\Throwable $e) {
    error_log('Unhandled Exception: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    // El detalle va solo al log del servidor: al cliente no se le dan rutas ni mensajes internos
    Response::error('Ocurrió un error interno en el servidor.', 500);
}
