-- ============================================================
-- OVERTIME MANAGER — SUPABASE DATABASE SETUP
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- 1. TABLES
-- ============================================================

CREATE TABLE managers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  manager_id UUID REFERENCES managers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE overtime_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  hours DECIMAL(4,1) NOT NULL CHECK (hours > 0 AND hours <= 16),
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  manager_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  target_role TEXT NOT NULL CHECK (target_role IN ('employee', 'manager', 'admin')),
  target_id UUID,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Links Supabase Auth users to employee/manager profiles
CREATE TABLE user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'admin')),
  profile_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. INDEXES (for performance)
-- ============================================================

CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_requests_employee ON overtime_requests(employee_id);
CREATE INDEX idx_requests_status ON overtime_requests(status);
CREATE INDEX idx_requests_date ON overtime_requests(date);
CREATE INDEX idx_notifications_target ON notifications(target_role, target_id);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);

-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: get current user's profile_id
CREATE OR REPLACE FUNCTION get_user_profile_id()
RETURNS UUID AS $$
  SELECT profile_id FROM user_profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- MANAGERS TABLE POLICIES
CREATE POLICY "Everyone can read managers" ON managers
  FOR SELECT USING (true);

CREATE POLICY "Admin manages managers" ON managers
  FOR ALL USING (get_user_role() = 'admin');

-- EMPLOYEES TABLE POLICIES
CREATE POLICY "Employee reads own record" ON employees
  FOR SELECT USING (id = get_user_profile_id() AND get_user_role() = 'employee');

CREATE POLICY "Manager reads own team" ON employees
  FOR SELECT USING (manager_id = get_user_profile_id() AND get_user_role() = 'manager');

CREATE POLICY "Admin manages employees" ON employees
  FOR ALL USING (get_user_role() = 'admin');

-- OVERTIME REQUESTS POLICIES
CREATE POLICY "Employee views own requests" ON overtime_requests
  FOR SELECT USING (employee_id = get_user_profile_id() AND get_user_role() = 'employee');

CREATE POLICY "Employee submits own requests" ON overtime_requests
  FOR INSERT WITH CHECK (employee_id = get_user_profile_id() AND get_user_role() = 'employee');

CREATE POLICY "Manager views team requests" ON overtime_requests
  FOR SELECT USING (
    get_user_role() = 'manager'
    AND employee_id IN (SELECT id FROM employees WHERE manager_id = get_user_profile_id())
  );

CREATE POLICY "Manager updates team requests" ON overtime_requests
  FOR UPDATE USING (
    get_user_role() = 'manager'
    AND employee_id IN (SELECT id FROM employees WHERE manager_id = get_user_profile_id())
  );

CREATE POLICY "Admin manages all requests" ON overtime_requests
  FOR ALL USING (get_user_role() = 'admin');

-- NOTIFICATIONS POLICIES
CREATE POLICY "Users read own notifications" ON notifications
  FOR SELECT USING (
    (target_role = get_user_role() AND target_id = get_user_profile_id())
    OR get_user_role() = 'admin'
  );

CREATE POLICY "System inserts notifications" ON notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admin manages notifications" ON notifications
  FOR ALL USING (get_user_role() = 'admin');

-- USER PROFILES POLICIES
CREATE POLICY "Users read own profile" ON user_profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Admin manages profiles" ON user_profiles
  FOR ALL USING (get_user_role() = 'admin');


-- 4. SAMPLE DATA (Optional — remove for production)
-- ============================================================

INSERT INTO managers (name, email, department) VALUES
  ('Ahmed Hassan', 'ahmed@platinumgroup.com', 'Engineering'),
  ('Mohamed Ali', 'mohamed@platinumgroup.com', 'Sales'),
  ('Sara Ibrahim', 'sara@platinumgroup.com', 'HR'),
  ('Khaled Yousef', 'khaled@platinumgroup.com', 'Finance'),
  ('Fatma Nabil', 'fatma@platinumgroup.com', 'Operations'),
  ('Tarek Mansour', 'tarek@platinumgroup.com', 'IT'),
  ('Rania Adel', 'rania@platinumgroup.com', 'Marketing'),
  ('Waleed Samir', 'waleed@platinumgroup.com', 'Quality'),
  ('Noha Ezzat', 'noha@platinumgroup.com', 'Logistics'),
  ('Hesham Fawzy', 'hesham@platinumgroup.com', 'Maintenance');

INSERT INTO employees (name, department, manager_id) VALUES
  ('Youssef Tarek', 'Engineering', (SELECT id FROM managers WHERE email = 'ahmed@platinumgroup.com')),
  ('Nour Adel', 'Engineering', (SELECT id FROM managers WHERE email = 'ahmed@platinumgroup.com')),
  ('Mina George', 'Engineering', (SELECT id FROM managers WHERE email = 'ahmed@platinumgroup.com')),
  ('Amira Sayed', 'Sales', (SELECT id FROM managers WHERE email = 'mohamed@platinumgroup.com')),
  ('Omar Fathy', 'Sales', (SELECT id FROM managers WHERE email = 'mohamed@platinumgroup.com')),
  ('Salma Khaled', 'Sales', (SELECT id FROM managers WHERE email = 'mohamed@platinumgroup.com')),
  ('Hana Mostafa', 'HR', (SELECT id FROM managers WHERE email = 'sara@platinumgroup.com')),
  ('Karim Wael', 'HR', (SELECT id FROM managers WHERE email = 'sara@platinumgroup.com')),
  ('Layla Ashraf', 'Finance', (SELECT id FROM managers WHERE email = 'khaled@platinumgroup.com')),
  ('Tamer Hossam', 'Finance', (SELECT id FROM managers WHERE email = 'khaled@platinumgroup.com')),
  ('Dina Magdy', 'Operations', (SELECT id FROM managers WHERE email = 'fatma@platinumgroup.com')),
  ('Mahmoud Reda', 'Operations', (SELECT id FROM managers WHERE email = 'fatma@platinumgroup.com')),
  ('Aya Sherif', 'IT', (SELECT id FROM managers WHERE email = 'tarek@platinumgroup.com')),
  ('Hassan Nabil', 'IT', (SELECT id FROM managers WHERE email = 'tarek@platinumgroup.com')),
  ('Farida Sameh', 'Marketing', (SELECT id FROM managers WHERE email = 'rania@platinumgroup.com')),
  ('Ramy Gamal', 'Quality', (SELECT id FROM managers WHERE email = 'waleed@platinumgroup.com')),
  ('Nada Emad', 'Logistics', (SELECT id FROM managers WHERE email = 'noha@platinumgroup.com')),
  ('Hazem Lotfy', 'Maintenance', (SELECT id FROM managers WHERE email = 'hesham@platinumgroup.com')),
  ('Yasmine Tawfik', 'Engineering', (SELECT id FROM managers WHERE email = 'ahmed@platinumgroup.com')),
  ('Adel Shokry', 'Operations', (SELECT id FROM managers WHERE email = 'fatma@platinumgroup.com'));


-- 5. USEFUL VIEWS (for admin dashboard)
-- ============================================================

-- Monthly overtime summary per employee
CREATE VIEW monthly_overtime_summary AS
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.department,
  m.name AS manager_name,
  DATE_TRUNC('month', r.date) AS month,
  SUM(r.hours) AS total_hours,
  COUNT(*) AS request_count
FROM overtime_requests r
JOIN employees e ON r.employee_id = e.id
LEFT JOIN managers m ON e.manager_id = m.id
WHERE r.status = 'approved'
GROUP BY e.id, e.name, e.department, m.name, DATE_TRUNC('month', r.date)
ORDER BY month DESC, total_hours DESC;

-- Department overtime summary
CREATE VIEW department_overtime_summary AS
SELECT
  e.department,
  DATE_TRUNC('month', r.date) AS month,
  SUM(r.hours) AS total_hours,
  COUNT(DISTINCT e.id) AS employee_count,
  COUNT(*) AS request_count
FROM overtime_requests r
JOIN employees e ON r.employee_id = e.id
WHERE r.status = 'approved'
GROUP BY e.department, DATE_TRUNC('month', r.date)
ORDER BY month DESC, total_hours DESC;

-- Pending requests count per manager
CREATE VIEW pending_per_manager AS
SELECT
  m.id AS manager_id,
  m.name AS manager_name,
  m.department,
  COUNT(r.id) AS pending_count
FROM managers m
LEFT JOIN employees e ON e.manager_id = m.id
LEFT JOIN overtime_requests r ON r.employee_id = e.id AND r.status = 'pending'
GROUP BY m.id, m.name, m.department;
