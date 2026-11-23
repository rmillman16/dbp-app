// Roles in the project directory (23 Nov, script 063): who someone is on a job: the client's team, the design team,
// consultants and statutory bodies, and every trade. The list is kept in the database (directory_roles) so anyone can add
// a role from the dropdown; until script 063 is run this built-in list is used. Roles are also what RFI and submittal
// templates look people up by ("Joinery subcontractor").
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export const ROLE_GROUPS: [string, string[]][] = [
  ['Client side', ['Client', 'Client PM', 'Client representative', "Employer's agent", 'Client facilities manager', 'Landlord', 'Tenant', 'Building owner', 'Funder', 'Occupier / end user']],
  [
    'Design team',
    [
      'Architect', 'Interior designer', 'Structural engineer', 'Civil engineer', 'M&E consultant', 'Mechanical engineer', 'Electrical engineer', 'Public health engineer', 'Lighting designer',
      'Acoustic consultant', 'Fire engineer', 'Façade engineer', 'Landscape architect', 'Catering / kitchen consultant', 'AV consultant', 'IT / data consultant', 'Security consultant',
      'Wayfinding / signage designer', 'Graphic designer', 'Art consultant', 'Vertical transportation consultant', 'Specification writer',
    ],
  ],
  [
    'Management, cost and statutory',
    [
      'Project manager (client side)', 'Quantity surveyor', 'Cost consultant', 'Contract administrator', 'Principal designer', 'CDM adviser', 'Health & safety adviser', 'Clerk of works',
      'Building control', 'Approved inspector', 'Planning consultant', 'Planning officer', 'Local authority', 'Fire safety officer', 'Party wall surveyor', 'Building surveyor', 'Land surveyor',
      'Asbestos surveyor', 'Sustainability / BREEAM consultant', 'Energy assessor', 'Heritage consultant', 'Ecologist', 'Arboriculturist', 'Highways consultant', 'Drainage consultant', 'Warranty provider', 'Insurer',
    ],
  ],
  [
    'Trades and subcontractors',
    [
      'Groundworks subcontractor', 'Demolition subcontractor', 'Strip-out subcontractor', 'Asbestos removal subcontractor', 'Concrete / RC frame subcontractor', 'Steelwork subcontractor',
      'Masonry subcontractor', 'Roofing subcontractor', 'Waterproofing subcontractor', 'Cladding subcontractor', 'Curtain walling subcontractor', 'Windows and doors subcontractor', 'Glazing subcontractor',
      'Carpentry subcontractor', 'Joinery subcontractor', 'Dry lining subcontractor', 'Ceilings subcontractor', 'Plastering subcontractor', 'Screed subcontractor', 'Flooring subcontractor',
      'Tiling subcontractor', 'Stonework subcontractor', 'Decorating subcontractor', 'Metalwork subcontractor', 'Balustrade subcontractor', 'Ironmongery supplier', 'Lift subcontractor',
      'Mechanical subcontractor', 'Electrical subcontractor', 'Plumbing / public health subcontractor', 'HVAC subcontractor', 'Fire protection subcontractor', 'Sprinkler subcontractor',
      'Fire alarm subcontractor', 'Security / access control subcontractor', 'CCTV subcontractor', 'AV subcontractor', 'Data / structured cabling subcontractor', 'BMS / controls subcontractor',
      'Lighting supplier', 'Kitchen fit-out subcontractor', 'Furniture supplier', 'FF&E supplier', 'Signage subcontractor', 'Scaffolding subcontractor', 'Hoarding subcontractor',
      'Cleaning subcontractor', 'Waste management', 'Landscaping subcontractor', 'Specialist finishes subcontractor', 'Testing and commissioning', 'Specialist subcontractor', 'Supplier', 'Manufacturer', 'Hire company',
      'Crane / lifting', 'Traffic management',
    ],
  ],
]
export const DEFAULT_ROLES = ROLE_GROUPS.flatMap(([, r]) => r)

let cache: string[] | null = null
const listeners = new Set<(r: string[]) => void>()
const sorted = (r: string[]) => [...new Set(r)].sort((a, b) => a.localeCompare(b, 'en-GB'))

async function fetchRoles(): Promise<string[]> {
  const r = await supabase.from('directory_roles').select('name')
  if (r.error || !r.data?.length) return sorted(DEFAULT_ROLES) // before script 063
  return sorted([...(r.data as { name: string }[]).map((x) => x.name), ...DEFAULT_ROLES])
}

// the roles list, with a way to add a new one (saved for everyone)
export function useDirectoryRoles() {
  const [roles, setRoles] = useState<string[]>(cache ?? sorted(DEFAULT_ROLES))
  useEffect(() => {
    listeners.add(setRoles)
    if (!cache) fetchRoles().then((r) => ((cache = r), listeners.forEach((l) => l(r))))
    return () => void listeners.delete(setRoles)
  }, [])
  const add = useCallback(async (name: string) => {
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n) return
    const r = await supabase.from('directory_roles').insert({ name: n })
    if (r.error && !/duplicate|unique/i.test(r.error.message)) throw new Error(/relation|schema cache|does not exist/i.test(r.error.message) ? 'Adding roles needs script 063 run in Supabase first.' : r.error.message)
    cache = sorted([...(cache ?? DEFAULT_ROLES), n])
    listeners.forEach((l) => l(cache!))
  }, [])
  return { roles, add }
}
