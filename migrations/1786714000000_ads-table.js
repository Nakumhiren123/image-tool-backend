exports.up = (pgm) => {
  pgm.createTable('ads', {
    id:         { type: 'serial', primaryKey: true },
    title:      { type: 'varchar(200)', notNull: true },
    position:   { type: 'varchar(50)', notNull: true },
    ad_client:  { type: 'varchar(200)' },
    ad_slot:    { type: 'varchar(200)' },
    is_active:  { type: 'boolean', default: true, notNull: true },
    created_at: { type: 'timestamp', default: pgm.func('NOW()') },
    updated_at: { type: 'timestamp', default: pgm.func('NOW()') },
  }, { ifNotExists: true });

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ads_position_check'
      ) THEN
        ALTER TABLE ads ADD CONSTRAINT ads_position_check CHECK (position IN ('leaderboard','rectangle','skyscraper','interstitial'));
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('ads', { ifExists: true });
};
