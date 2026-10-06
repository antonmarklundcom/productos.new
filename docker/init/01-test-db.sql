-- La base de tests la borra y recrea el runner de vitest en cada corrida;
-- acá sólo nos aseguramos de que el usuario `ecom` pueda hacerlo.
CREATE DATABASE IF NOT EXISTS `ecom_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `ecom_test`.* TO 'ecom'@'%';
GRANT CREATE, DROP ON *.* TO 'ecom'@'%';
FLUSH PRIVILEGES;
