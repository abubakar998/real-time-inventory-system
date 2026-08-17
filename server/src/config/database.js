'use strict';

const { Sequelize } = require('sequelize');
const config = require('./env');

const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: config.sqlLog ? (sql) => console.log('[sql]', sql) : false,
  dialectOptions: config.useSsl
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : {},
  // Reservation traffic is short, bursty and write-heavy. A generous pool keeps
  // the row-lock queue on a hot drop moving instead of timing out in the pool.
  pool: { max: 20, min: 0, idle: 10_000, acquire: 30_000 },
  define: { underscored: true, timestamps: true, freezeTableName: true },
  retry: { max: 0 },
});

module.exports = { sequelize, Sequelize };
