ALTER TABLE plans ADD COLUMN short_name TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_slots ADD COLUMN capacity_weekend INTEGER;
ALTER TABLE plan_slots ADD COLUMN deadline_days INTEGER;
ALTER TABLE plan_slots ADD COLUMN deadline_time TEXT;
ALTER TABLE bookings ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '[]';

CREATE TABLE price_overrides (
  date TEXT NOT NULL,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  price_adult INTEGER NOT NULL CHECK (price_adult >= 0),
  price_child INTEGER NOT NULL CHECK (price_child >= 0),
  PRIMARY KEY (date, plan_id)
);

CREATE TABLE plan_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
