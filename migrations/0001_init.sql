CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE plan_resources (
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  PRIMARY KEY (plan_id, resource_id)
);

CREATE TABLE slot_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE plan_slots (
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  slot_type_id INTEGER NOT NULL REFERENCES slot_types(id),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (plan_id, slot_type_id)
);

CREATE TABLE slot_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot_type_id INTEGER NOT NULL REFERENCES slot_types(id),
  plan_id INTEGER REFERENCES plans(id),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_slot_closures_date ON slot_closures (date, slot_type_id);

CREATE TABLE agencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  date TEXT NOT NULL,
  slot_type_id INTEGER NOT NULL REFERENCES slot_types(id),
  agency_id INTEGER REFERENCES agencies(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  total_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'onsite_cash' CHECK (payment_method IN ('onsite_cash', 'onsite_card', 'invoice', 'stripe')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL CHECK (created_by IN ('admin', 'agency')),
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_bookings_slot ON bookings (date, slot_type_id, status);
CREATE INDEX idx_bookings_agency ON bookings (agency_id, date);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id),
  to_address TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
