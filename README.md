# FinHub

Aplicación web autoalojada para llevar tus finanzas personales: cuentas, movimientos y categorías, resumen mensual,
balances, proyecciones, gastos previstos e inversiones en fondos indexados.

- **Backend:** API REST en PHP 8.1+ sin dependencias externas, con MySQL 8 o MariaDB 10+.
- **Frontend:** SPA en React + Vite.

## Requisitos del servidor

- Apache 2.4 con `mod_rewrite` y `AllowOverride All` (se usa el `.htaccess` de `api/`).
- PHP 8.1 o superior con las extensiones `pdo_mysql` y `mbstring` (y `curl`, opcional, para los precios de los fondos).
- Una base de datos MySQL 8 o MariaDB 10+, y un usuario con permisos sobre ella.

## Instalación

1. Copia el contenido de la release (o el resultado de `npm run release`, ver más abajo) en una carpeta del servidor
   web, por ejemplo `/finhub`. Debe quedar así:

   ```
   finhub/
   ├── index.html, assets/ …   # frontend compilado
   └── api/                    # API PHP
   ```

2. Da permiso de escritura al servidor web sobre `api/config/` (solo durante la instalación).
3. Abre la carpeta en el navegador (`http://tu-servidor/finhub/`). Se abre el **asistente de instalación**, que:
   - comprueba los requisitos del servidor,
   - prueba la conexión con la base de datos (y la crea si no existe y el usuario tiene permiso),
   - crea las tablas y las categorías iniciales,
   - crea la cuenta de administrador,
   - guarda la configuración (zona horaria, si se permite el registro de otras personas) en `api/config/config.local.php`.
4. Quita el permiso de escritura de `api/config/`.

Para reinstalar desde cero, borra `api/config/config.local.php`. Si la base de datos ya contiene una instalación de
FinHub (por ejemplo, al trasladarla a otro servidor), el asistente la conserva y no crea un administrador nuevo.

### Synology (Web Station)

- En Web Station, crea un portal o servicio web con **Apache 2.4** como servidor HTTP (no Nginx) y un perfil de PHP
  con `pdo_mysql`, `mbstring` y `curl` activados.
- El paquete **MariaDB 10** escucha en el puerto **3307**. Crea la base de datos y el usuario con phpMyAdmin.
- Para acceder desde fuera de tu red, configura HTTPS (Panel de control → Seguridad → Certificado).

## Actualizar

Sustituye los archivos por los de la versión nueva **conservando `api/config/config.local.php`**. Los cambios en la
base de datos se aplican solos en la primera petición (o con `php api/database/migrate.php`).

## Desarrollo

Con WAMP/XAMPP sirviendo este repositorio (por ejemplo en `http://localhost/finhub2.0/`):

```bash
cd frontend
npm install
npm run dev
```

El servidor de Vite reenvía `/api` a Apache. Si el repositorio está en otra carpeta, copia `frontend/.env.example`
como `frontend/.env` y ajusta `DEV_API_TARGET`. La primera vez, el navegador mostrará el asistente de instalación.

- `npm run lint`: análisis estático del frontend.
- `npm run release`: compila el frontend y genera `release/finhub/` (frontend + API, sin tu configuración), lista
  para copiar al servidor.

### Estructura

```
api/
├── config/config.php         # valores por defecto (config.local.php, el de cada instalación, no se versiona)
├── database/migrations/      # NNN_nombre.sql, se aplican en orden y una sola vez
├── database/migrate.php      # aplica migraciones pendientes desde la línea de comandos
├── src/                      # controladores, configuración y utilidades (namespace FinHub\)
└── index.php                 # punto de entrada y router
frontend/
├── src/components/           # vistas React
├── src/services/api.js       # cliente HTTP
└── scripts/release.mjs       # empaquetado de la release
```

Para añadir un cambio de base de datos, crea `api/database/migrations/NNN_descripcion.sql` con el siguiente número.

## Precios de fondos

Los valores liquidativos se descargan de un servicio público no oficial de Yahoo Finance. Puede dejar de funcionar o
cambiar sin aviso; en ese caso, la valoración de las cuentas sigue funcionando con las valoraciones manuales.

## Licencia

[Apache 2.0](LICENSE)
