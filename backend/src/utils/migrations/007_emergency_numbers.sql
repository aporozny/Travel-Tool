CREATE TABLE IF NOT EXISTS emergency_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code VARCHAR(2) NOT NULL,
  country_name VARCHAR(100) NOT NULL,
  service_type VARCHAR(50) NOT NULL,
  number VARCHAR(30) NOT NULL,
  description TEXT,
  hours VARCHAR(100),
  language VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(country_code, service_type, number)
);

CREATE INDEX idx_emergency_country ON emergency_numbers(country_code);
CREATE INDEX idx_emergency_type ON emergency_numbers(service_type);

INSERT INTO emergency_numbers (country_code, country_name, service_type, number, description, hours, language) VALUES
-- AUSTRALIA
('AU', 'Australia', 'police', '000', 'Police, fire, ambulance', '24/7', 'English'),
('AU', 'Australia', 'hospital', '1300 135 541', 'Royal Flying Doctor Service', '24/7', 'English'),

-- INDONESIA (Bali, Jakarta, etc)
('ID', 'Indonesia', 'police', '110', 'Polisi', '24/7', 'Indonesian/English'),
('ID', 'Indonesia', 'ambulance', '118', 'Ambulans', '24/7', 'Indonesian/English'),
('ID', 'Indonesia', 'fire', '113', 'Pemadam Kebakaran', '24/7', 'Indonesian/English'),
('ID', 'Indonesia', 'tourist_police', '+62-274-515235', 'Yogyakarta Tourist Police', '24/7', 'English'),

-- THAILAND
('TH', 'Thailand', 'police', '191', 'Tourist Police (English)', '24/7', 'English'),
('TH', 'Thailand', 'ambulance', '1554', 'Ambulans', '24/7', 'Thai/English'),
('TH', 'Thailand', 'hospital', '1669', 'Hospital Emergency', '24/7', 'Thai/English'),

-- PHILIPPINES
('PH', 'Philippines', 'police', '911', 'Police and emergency', '24/7', 'English'),
('PH', 'Philippines', 'ambulance', '911', 'Emergency ambulance', '24/7', 'English'),

-- UNITED STATES
('US', 'United States', 'police', '911', 'Police, fire, ambulance', '24/7', 'English'),
('US', 'United States', 'poison_control', '1-800-222-1222', 'Poison Control Center', '24/7', 'English'),

-- UNITED KINGDOM
('GB', 'United Kingdom', 'police', '999', 'Police, fire, ambulance', '24/7', 'English'),
('GB', 'United Kingdom', 'non_emergency', '101', 'Police non-emergency', '24/7', 'English'),

-- CANADA
('CA', 'Canada', 'police', '911', 'Police, fire, ambulance', '24/7', 'English/French'),

-- NEW ZEALAND
('NZ', 'New Zealand', 'police', '111', 'Police, fire, ambulance', '24/7', 'English'),

-- SINGAPORE
('SG', 'Singapore', 'police', '999', 'Police, fire, ambulance', '24/7', 'English/Chinese'),
('SG', 'Singapore', 'hospital', '6222 3322', 'Singapore General Hospital', '24/7', 'English'),

-- MALAYSIA
('MY', 'Malaysia', 'police', '999', 'Polis', '24/7', 'Malay/English'),
('MY', 'Malaysia', 'ambulance', '994', 'Ambulans', '24/7', 'Malay/English'),

-- VIETNAM
('VN', 'Vietnam', 'police', '113', 'Canh sat', '24/7', 'Vietnamese/English'),
('VN', 'Vietnam', 'ambulance', '115', 'Cuu thương', '24/7', 'Vietnamese/English'),
('VN', 'Vietnam', 'fire', '114', 'Canh sat phong chay', '24/7', 'Vietnamese'),

-- JAPAN
('JP', 'Japan', 'police', '110', 'Keisatsu', '24/7', 'Japanese/English'),
('JP', 'Japan', 'ambulance', '119', 'Kyūkyūsha', '24/7', 'Japanese/English'),

-- SOUTH KOREA
('KR', 'South Korea', 'police', '112', 'Gyungchal', '24/7', 'Korean/English'),
('KR', 'South Korea', 'ambulance', '119', 'Ambulance', '24/7', 'Korean/English'),

-- TAIWAN
('TW', 'Taiwan', 'police', '110', 'Jingcha', '24/7', 'Mandarin/English'),
('TW', 'Taiwan', 'ambulance', '119', 'Jiuhuche', '24/7', 'Mandarin/English'),

-- INDIA
('IN', 'India', 'police', '100', 'Pulis', '24/7', 'Hindi/English'),
('IN', 'India', 'ambulance', '102', 'Ambulans', '24/7', 'Hindi/English'),

-- HONG KONG
('HK', 'Hong Kong', 'police', '999', 'Police, fire, ambulance', '24/7', 'English/Cantonese'),

-- FRANCE
('FR', 'France', 'police', '17', 'Gendarmerie', '24/7', 'French/English'),
('FR', 'France', 'ambulance', '15', 'SAMU', '24/7', 'French/English'),

-- SPAIN
('ES', 'Spain', 'police', '091', 'Policia Nacional', '24/7', 'Spanish/English'),
('ES', 'Spain', 'emergency', '112', 'Emergency (EU standard)', '24/7', 'Spanish/English'),

-- ITALY
('IT', 'Italy', 'police', '113', 'Polizia', '24/7', 'Italian/English'),
('IT', 'Italy', 'ambulance', '118', 'Ambulanza', '24/7', 'Italian/English'),

-- GERMANY
('DE', 'Germany', 'police', '110', 'Polizei', '24/7', 'German/English'),
('DE', 'Germany', 'ambulance', '112', 'Rettungsdienst', '24/7', 'German/English'),

-- MEXICO
('MX', 'Mexico', 'emergency', '911', 'Police, fire, ambulance', '24/7', 'Spanish/English'),

-- BRAZIL
('BR', 'Brazil', 'police', '190', 'Policia', '24/7', 'Portuguese/English'),
('BR', 'Brazil', 'ambulance', '192', 'Ambulancia', '24/7', 'Portuguese/English'),

-- ARGENTINA
('AR', 'Argentina', 'police', '911', 'Police, fire, ambulance', '24/7', 'Spanish/English'),

-- CHILE
('CL', 'Chile', 'emergency', '911', 'Carabineros/ambulance', '24/7', 'Spanish/English'),

-- PERU
('PE', 'Peru', 'police', '105', 'Policia', '24/7', 'Spanish/English'),
('PE', 'Peru', 'ambulance', '106', 'Ambulancia', '24/7', 'Spanish/English'),

-- COLOMBIA
('CO', 'Colombia', 'police', '112', 'Policia', '24/7', 'Spanish/English'),

-- TURKEY
('TR', 'Turkey', 'police', '155', 'Polis', '24/7', 'Turkish/English'),
('TR', 'Turkey', 'ambulance', '112', 'Ambulans', '24/7', 'Turkish/English'),

-- EGYPT
('EG', 'Egypt', 'police', '122', 'Shorta', '24/7', 'Arabic/English'),

-- SOUTH AFRICA
('ZA', 'South Africa', 'police', '10177', 'SAPS', '24/7', 'English'),
('ZA', 'South Africa', 'ambulance', '10177', 'Emergency', '24/7', 'English'),

-- THAILAND EMBASSY NUMBERS (added to help travelers)
('TH', 'Thailand', 'embassy_au', '+66-2-344-6300', 'Australian Embassy Bangkok', 'Business hours', 'English'),

-- INDONESIA EMBASSY
('ID', 'Indonesia', 'embassy_au', '+62-21-522-7111', 'Australian Embassy Jakarta', 'Business hours', 'English');
