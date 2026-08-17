'use strict';

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Models mirror server/sql/schema.sql. `sequelize.sync()` is deliberately never
 * called — the SQL file owns the schema, these definitions own reads/writes.
 */

const User = sequelize.define(
  'User',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING(32), allowNull: false },
  },
  { tableName: 'users' }
);

const Drop = sequelize.define(
  'Drop',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    description: { type: DataTypes.TEXT },
    imageUrl: { type: DataTypes.TEXT, field: 'image_url' },
    priceCents: { type: DataTypes.INTEGER, allowNull: false, field: 'price_cents' },

    totalStock: { type: DataTypes.INTEGER, allowNull: false, field: 'total_stock' },
    reservedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'reserved_count',
    },
    soldCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'sold_count',
    },

    reservationWindowSeconds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 60,
      field: 'reservation_window_seconds',
    },

    startsAt: { type: DataTypes.DATE, allowNull: false, field: 'starts_at' },
    endsAt: { type: DataTypes.DATE, field: 'ends_at' },

    availableStock: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue('totalStock') - this.getDataValue('reservedCount') - this.getDataValue('soldCount');
      },
    },
  },
  { tableName: 'drops' }
);

const Reservation = sequelize.define(
  'Reservation',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    dropId: { type: DataTypes.INTEGER, allowNull: false, field: 'drop_id' },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    status: {
      type: DataTypes.ENUM('active', 'completed', 'expired', 'cancelled'),
      allowNull: false,
      defaultValue: 'active',
    },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
  },
  { tableName: 'reservations' }
);

const Purchase = sequelize.define(
  'Purchase',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    dropId: { type: DataTypes.INTEGER, allowNull: false, field: 'drop_id' },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    reservationId: { type: DataTypes.INTEGER, allowNull: false, field: 'reservation_id' },
    priceCents: { type: DataTypes.INTEGER, allowNull: false, field: 'price_cents' },
  },
  { tableName: 'purchases', updatedAt: false }
);

Drop.hasMany(Reservation, { foreignKey: 'dropId', as: 'reservations' });
Reservation.belongsTo(Drop, { foreignKey: 'dropId', as: 'drop' });

User.hasMany(Reservation, { foreignKey: 'userId', as: 'reservations' });
Reservation.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Drop.hasMany(Purchase, { foreignKey: 'dropId', as: 'purchases' });
Purchase.belongsTo(Drop, { foreignKey: 'dropId', as: 'drop' });

User.hasMany(Purchase, { foreignKey: 'userId', as: 'purchases' });
Purchase.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Reservation.hasOne(Purchase, { foreignKey: 'reservationId', as: 'purchase' });
Purchase.belongsTo(Reservation, { foreignKey: 'reservationId', as: 'reservation' });

module.exports = { sequelize, User, Drop, Reservation, Purchase };
