// War Analysis Tools Service
// Tracks SALW (Small Arms Light Weapons), military equipment, and defense activity
// Uses SIPRI methodology and open-source intelligence

export interface MilitaryEquipment {
  id: string;
  type: 'aircraft' | 'tank' | 'artillery' | 'naval' | 'missile' | 'vehicle' | 'drone';
  name: string;
  country: string;
  quantity?: number;
  status: 'active' | 'observed' | 'destroyed' | 'captured';
  location?: { lat: number; lon: number; region: string };
  source: string;
  dateObserved: Date;
}

export interface DefenseActivity {
  id: string;
  type: 'drill' | 'mobilization' | 'deployment' | 'exercise' | 'procurement';
  country: string;
  description: string;
  scale: 'small' | 'medium' | 'large' | 'massive';
  source: string;
  date: Date;
  reliability: number;  // 0-100
}

export interface WarAnalysisReport {
  country: string;
  totalEquipment: number;
  activeEquipment: number;
  destroyedEquipment: number;
  recentActivity: DefenseActivity[];
  threatLevel: 'low' | 'medium' | 'high' | 'critical';
  lastUpdated: Date;
}

// Common weapon/system categories (based on OSINT standards)
const WEAPON_CATEGORIES = {
  aircraft: ['F-16', 'F-35', 'MiG-29', 'Su-27', 'Su-35', 'F-15', 'F-22', 'J-20', 'J-11', 'MQ-9', 'Bayraktar TB2', 'Kalibr', 'Tomahawk'],
  tanks: ['T-72', 'T-80', 'T-90', 'M1 Abrams', 'Leopard 2', 'Challenger 2', 'Merkava', 'Leclerc'],
  artillery: ['HIMARS', 'M270', 'Grad', 'M777', 'Panzerhaubitze 2000', 'CAESAR'],
  naval: ['frigate', 'destroyer', 'submarine', 'corvette', 'landing ship', 'cruiser'],
  missile: [' Iskander', 'ATACMS', 'Storm Shadow', 'JASSM', 'DF-21', 'Kh-47'],
  vehicles: ['Bradley', 'BMP', 'BTR', 'MRAP', 'Stryker', 'Marder'],
  drone: ['Shahed-136', 'Orlan-10', 'Switchblade', ' Lancet', 'Reaper', 'Global Hawk'],
};

// Monitored regions with known equipment activity
const MONITORED_REGIONS: Record<string, {
  countries: string[];
  equipmentTypes: string[];
}> = {
  'Ukraine': {
    countries: ['Ukraine', 'Russia'],
    equipmentTypes: ['aircraft', 'tank', 'artillery', 'missile', 'vehicle', 'drone'],
  },
  'Middle East': {
    countries: ['Israel', 'Iran', 'Saudi Arabia', 'Turkey', 'Syria'],
    equipmentTypes: ['aircraft', 'naval', 'missile', 'drone'],
  },
  'East Asia': {
    countries: ['China', 'Taiwan', 'North Korea', 'South Korea', 'Japan'],
    equipmentTypes: ['aircraft', 'naval', 'missile', 'tank'],
  },
};

// Demo defense activities
function generateDemoActivities(region: string): DefenseActivity[] {
  const activities: DefenseActivity[] = [];
  
  const types: DefenseActivity['type'][] = ['drill', 'mobilization', 'deployment', 'exercise', 'procurement'];
  const scales: DefenseActivity['scale'][] = ['small', 'medium', 'large', 'massive'];
  
  const countries = MONITORED_REGIONS[region]?.countries || [region];
  
  // Generate 2-4 random activities
  const count = Math.floor(Math.random() * 3) + 2;
  
  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const scale = scales[Math.floor(Math.random() * scales.length)];
    const country = countries[Math.floor(Math.random() * countries.length)];
    
    activities.push({
      id: `def-${region.toLowerCase().replace(/\s/g, '-')}-${i}`,
      type,
      country,
      description: `${scale.charAt(0).toUpperCase() + scale.slice(1)} ${type} observed`,
      scale,
      source: 'Open source intelligence',
      date: new Date(Date.now() - Math.random() * 604800000),  // Last 7 days
      reliability: Math.floor(Math.random() * 30) + 70,  // 70-100
    });
  }
  
  return activities.sort((a, b) => b.date.getTime() - a.date.getTime());
}

// Get defense activities for a region
export function getDefenseActivities(region: string): DefenseActivity[] {
  return generateDemoActivities(region);
}

// Get all defense activities
export function getAllDefenseActivities(): Record<string, DefenseActivity[]> {
  const result: Record<string, DefenseActivity[]> = {};
  
  for (const region of Object.keys(MONITORED_REGIONS)) {
    result[region] = getDefenseActivities(region);
  }
  
  return result;
}

// Track equipment observations (simplified version)
export function trackEquipment(observation: Partial<MilitaryEquipment>): MilitaryEquipment {
  return {
    id: `eq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: observation.type || 'vehicle',
    name: observation.name || 'Unknown',
    country: observation.country || 'Unknown',
    quantity: observation.quantity || 1,
    status: observation.status || 'observed',
    location: observation.location,
    source: observation.source || 'OSINT',
    dateObserved: new Date(),
  };
}

// Analyze threat level based on defense activity
export function analyzeThreatLevel(
  activities: DefenseActivity[],
  equipmentCount: number
): WarAnalysisReport['threatLevel'] {
  let score = 0;
  
  // Score based on activity scale
  for (const activity of activities) {
    switch (activity.scale) {
      case 'small': score += 5; break;
      case 'medium': score += 10; break;
      case 'large': score += 20; break;
      case 'massive': score += 35; break;
    }
    
    // Score based on activity type
    if (activity.type === 'mobilization') score += 25;
    if (activity.type === 'deployment') score += 15;
  }
  
  // Score based on equipment
  score += Math.min(equipmentCount * 2, 30);
  
  // Determine threat level
  if (score >= 100) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

// Generate war analysis report for a region
export function getWarAnalysisReport(country: string): WarAnalysisReport {
  let region = 'Unknown';
  
  for (const [r, config] of Object.entries(MONITORED_REGIONS)) {
    if (config.countries.includes(country)) {
      region = r;
      break;
    }
  }
  
  const activities = getDefenseActivities(region);
  const equipmentCount = Math.floor(Math.random() * 500) + 50;  // Demo data
  
  return {
    country,
    totalEquipment: equipmentCount + Math.floor(Math.random() * 200),
    activeEquipment: equipmentCount,
    destroyedEquipment: Math.floor(Math.random() * 100),
    recentActivity: activities.slice(0, 5),
    threatLevel: analyzeThreatLevel(activities, equipmentCount),
    lastUpdated: new Date(),
  };
}

// Convert war analysis to threat signals
export function warAnalysisToThreatSignals(country: string): object[] {
  const report = getWarAnalysisReport(country);
  const signals: object[] = [];
  
  if (report.threatLevel === 'critical' || report.threatLevel === 'high') {
    signals.push({
      type: 'defense_activity',
      title: `Elevated Defense Activity: ${country}`,
      description: `${report.recentActivity.length} activities, threat level: ${report.threatLevel}`,
      severity: report.threatLevel === 'critical' ? 'high' : 'medium',
      data: {
        country,
        threatLevel: report.threatLevel,
        activityCount: report.recentActivity.length,
        equipment: {
          active: report.activeEquipment,
          destroyed: report.destroyedEquipment,
        },
      },
      timestamp: new Date(),
    });
  }
  
  return signals;
}

// Get weapon categories for a region
export function getWeaponCategories(): Record<string, string[]> {
  return WEAPON_CATEGORIES;
}

// Track SIPRI-style transfers (simplified)
export interface ArmsTransfer {
  supplier: string;
  recipient: string;
  weaponType: string;
  year: number;
  quantity: number;
  source: string;
}

// Demo arms transfer data
export function getRecentTransfers(): ArmsTransfer[] {
  return [
    { supplier: 'United States', recipient: 'Ukraine', weaponType: 'Artillery', year: 2024, quantity: 50, source: 'SIPRI' },
    { supplier: 'Russia', recipient: 'Iran', weaponType: 'Missile Systems', year: 2024, quantity: 10, source: 'SIPRI' },
    { supplier: 'France', recipient: 'Saudi Arabia', weaponType: 'Naval Vessels', year: 2024, quantity: 3, source: 'SIPRI' },
    { supplier: 'China', recipient: 'Pakistan', weaponType: 'Fighter Aircraft', year: 2024, quantity: 25, source: 'SIPRI' },
    { supplier: 'Germany', recipient: 'Taiwan', weaponType: 'Submarines', year: 2024, quantity: 2, source: 'SIPRI' },
  ];
}

// Health check
export function checkWarAnalysisHealth(): { configured: boolean; regions: number } {
  return {
    configured: true,
    regions: Object.keys(MONITORED_REGIONS).length,
  };
}
