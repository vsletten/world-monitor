// ============================================================================
// AEGIS // CIA WORLD FACTBOOK & GLOBAL COUNTRY SPATIAL INTELLIGENCE ENGINE
// Powered by world-atlas (50m), topojson-client, d3-geo & factbook.json
// ============================================================================

import { geoContains, geoCentroid, geoArea, geoBounds } from 'd3-geo';
import { feature } from 'topojson-client';
import worldTopo50 from 'world-atlas/countries-50m.json' with { type: 'json' };

const FACTBOOK_CDN_BASE = 'https://cdn.jsdelivr.net/gh/factbook/factbook.json@master';
const FACTBOOK_PROXY_BASE = '/live-api/factbook/gh/factbook/factbook.json@master';
const WORLDBANK_API_BASE = 'https://api.worldbank.org/v2';
const WORLDBANK_PROXY_BASE = '/live-api/worldbank/v2';
const WB_INDICATORS = 'SP.POP.TOTL;NY.GDP.MKTP.PP.CD;NY.GDP.PCAP.PP.CD;IT.NET.USER.ZS;MS.MIL.XPND.GD.ZS';
const FETCH_TIMEOUT_MS = 10000;
const WORLDBANK_TIMEOUT_MS = 7000;

// ----------------------------------------------------------------------------
// Authoritative Country & Territory Metadata Table (ISO-3166-1 + CIA Factbook)
// Tuple format: [iso2, iso3, displayName, region, factbookPath, ciaSlug]
// Keyed by world-atlas ISO numeric ID (3-digit string).
// Note: CIA GEC/FIPS codes frequently differ from ISO-2 (e.g. CH->sz, CN->ch,
// DE->gm, JP->ja, GB->uk, RU->rs, ZA->sf, AU->as, AT->au, SE->sw, ES->sp,
// TR->tu, UA->up, KR->ks, KP->kn, IL->is, GM->ga, GA->gb, NG->ni, NE->ng).
// ----------------------------------------------------------------------------
const COUNTRY_META_BY_NUMERIC = {
  '004': ['AF', 'AFG', 'Afghanistan', 'SOUTH ASIA', 'south-asia/af.json', 'afghanistan'],
  '008': ['AL', 'ALB', 'Albania', 'EUROPE', 'europe/al.json', 'albania'],
  '010': ['AQ', 'ATA', 'Antarctica', 'ANTARCTICA', 'antarctica/ay.json', 'antarctica'],
  '012': ['DZ', 'DZA', 'Algeria', 'AFRICA', 'africa/ag.json', 'algeria'],
  '016': ['AS', 'ASM', 'American Samoa', 'OCEANIA', 'australia-oceania/aq.json', 'american-samoa'],
  '020': ['AD', 'AND', 'Andorra', 'EUROPE', 'europe/an.json', 'andorra'],
  '024': ['AO', 'AGO', 'Angola', 'AFRICA', 'africa/ao.json', 'angola'],
  '028': ['AG', 'ATG', 'Antigua and Barbuda', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/ac.json', 'antigua-and-barbuda'],
  '031': ['AZ', 'AZE', 'Azerbaijan', 'CENTRAL ASIA', 'central-asia/aj.json', 'azerbaijan'],
  '032': ['AR', 'ARG', 'Argentina', 'SOUTH AMERICA', 'south-america/ar.json', 'argentina'],
  '036': ['AU', 'AUS', 'Australia', 'OCEANIA', 'australia-oceania/as.json', 'australia'],
  '040': ['AT', 'AUT', 'Austria', 'EUROPE', 'europe/au.json', 'austria'],
  '044': ['BS', 'BHS', 'Bahamas', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/bf.json', 'the-bahamas'],
  '048': ['BH', 'BHR', 'Bahrain', 'MIDDLE EAST', 'middle-east/ba.json', 'bahrain'],
  '050': ['BD', 'BGD', 'Bangladesh', 'SOUTH ASIA', 'south-asia/bg.json', 'bangladesh'],
  '051': ['AM', 'ARM', 'Armenia', 'CENTRAL ASIA', 'central-asia/am.json', 'armenia'],
  '052': ['BB', 'BRB', 'Barbados', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/bb.json', 'barbados'],
  '056': ['BE', 'BEL', 'Belgium', 'EUROPE', 'europe/be.json', 'belgium'],
  '060': ['BM', 'BMU', 'Bermuda', 'NORTH AMERICA', 'north-america/bd.json', 'bermuda'],
  '064': ['BT', 'BTN', 'Bhutan', 'SOUTH ASIA', 'south-asia/bt.json', 'bhutan'],
  '068': ['BO', 'BOL', 'Bolivia', 'SOUTH AMERICA', 'south-america/bl.json', 'bolivia'],
  '070': ['BA', 'BIH', 'Bosnia and Herzegovina', 'EUROPE', 'europe/bk.json', 'bosnia-and-herzegovina'],
  '072': ['BW', 'BWA', 'Botswana', 'AFRICA', 'africa/bc.json', 'botswana'],
  '076': ['BR', 'BRA', 'Brazil', 'SOUTH AMERICA', 'south-america/br.json', 'brazil'],
  '084': ['BZ', 'BLZ', 'Belize', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/bh.json', 'belize'],
  '086': ['IO', 'IOT', 'British Indian Ocean Territory', 'SOUTH ASIA', 'south-asia/io.json', 'british-indian-ocean-territory'],
  '090': ['SB', 'SLB', 'Solomon Islands', 'OCEANIA', 'australia-oceania/bp.json', 'solomon-islands'],
  '092': ['VG', 'VGB', 'British Virgin Islands', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/vi.json', 'british-virgin-islands'],
  '096': ['BN', 'BRN', 'Brunei', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/bx.json', 'brunei'],
  '100': ['BG', 'BGR', 'Bulgaria', 'EUROPE', 'europe/bu.json', 'bulgaria'],
  '104': ['MM', 'MMR', 'Myanmar', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/bm.json', 'burma'],
  '108': ['BI', 'BDI', 'Burundi', 'AFRICA', 'africa/by.json', 'burundi'],
  '112': ['BY', 'BLR', 'Belarus', 'EUROPE', 'europe/bo.json', 'belarus'],
  '116': ['KH', 'KHM', 'Cambodia', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/cb.json', 'cambodia'],
  '120': ['CM', 'CMR', 'Cameroon', 'AFRICA', 'africa/cm.json', 'cameroon'],
  '124': ['CA', 'CAN', 'Canada', 'NORTH AMERICA', 'north-america/ca.json', 'canada'],
  '132': ['CV', 'CPV', 'Cabo Verde', 'AFRICA', 'africa/cv.json', 'cabo-verde'],
  '136': ['KY', 'CYM', 'Cayman Islands', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/cj.json', 'cayman-islands'],
  '140': ['CF', 'CAF', 'Central African Republic', 'AFRICA', 'africa/ct.json', 'central-african-republic'],
  '144': ['LK', 'LKA', 'Sri Lanka', 'SOUTH ASIA', 'south-asia/ce.json', 'sri-lanka'],
  '148': ['TD', 'TCD', 'Chad', 'AFRICA', 'africa/cd.json', 'chad'],
  '152': ['CL', 'CHL', 'Chile', 'SOUTH AMERICA', 'south-america/ci.json', 'chile'],
  '156': ['CN', 'CHN', 'China', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/ch.json', 'china'],
  '158': ['TW', 'TWN', 'Taiwan', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/tw.json', 'taiwan'],
  '170': ['CO', 'COL', 'Colombia', 'SOUTH AMERICA', 'south-america/co.json', 'colombia'],
  '174': ['KM', 'COM', 'Comoros', 'AFRICA', 'africa/cn.json', 'comoros'],
  '178': ['CG', 'COG', 'Republic of the Congo', 'AFRICA', 'africa/cf.json', 'congo-brazzaville'],
  '180': ['CD', 'COD', 'Democratic Republic of the Congo', 'AFRICA', 'africa/cg.json', 'drc'],
  '184': ['CK', 'COK', 'Cook Islands', 'OCEANIA', 'australia-oceania/cw.json', 'cook-islands'],
  '188': ['CR', 'CRI', 'Costa Rica', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/cs.json', 'costa-rica'],
  '191': ['HR', 'HRV', 'Croatia', 'EUROPE', 'europe/hr.json', 'croatia'],
  '192': ['CU', 'CUB', 'Cuba', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/cu.json', 'cuba'],
  '196': ['CY', 'CYP', 'Cyprus', 'EUROPE', 'europe/cy.json', 'cyprus'],
  '203': ['CZ', 'CZE', 'Czechia', 'EUROPE', 'europe/ez.json', 'czechia'],
  '204': ['BJ', 'BEN', 'Benin', 'AFRICA', 'africa/bn.json', 'benin'],
  '208': ['DK', 'DNK', 'Denmark', 'EUROPE', 'europe/da.json', 'denmark'],
  '212': ['DM', 'DMA', 'Dominica', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/do.json', 'dominica'],
  '214': ['DO', 'DOM', 'Dominican Republic', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/dr.json', 'dominican-republic'],
  '218': ['EC', 'ECU', 'Ecuador', 'SOUTH AMERICA', 'south-america/ec.json', 'ecuador'],
  '222': ['SV', 'SLV', 'El Salvador', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/es.json', 'el-salvador'],
  '226': ['GQ', 'GNQ', 'Equatorial Guinea', 'AFRICA', 'africa/ek.json', 'equatorial-guinea'],
  '231': ['ET', 'ETH', 'Ethiopia', 'AFRICA', 'africa/et.json', 'ethiopia'],
  '232': ['ER', 'ERI', 'Eritrea', 'AFRICA', 'africa/er.json', 'eritrea'],
  '233': ['EE', 'EST', 'Estonia', 'EUROPE', 'europe/en.json', 'estonia'],
  '234': ['FO', 'FRO', 'Faroe Islands', 'EUROPE', 'europe/fo.json', 'faroe-islands'],
  '238': ['FK', 'FLK', 'Falkland Islands', 'SOUTH AMERICA', 'south-america/fk.json', 'falkland-islands-islas-malvinas'],
  '239': ['GS', 'SGS', 'South Georgia and the South Sandwich Islands', 'SOUTH AMERICA', 'south-america/sx.json', 'south-georgia-and-south-sandwich-islands'],
  '242': ['FJ', 'FJI', 'Fiji', 'OCEANIA', 'australia-oceania/fj.json', 'fiji'],
  '246': ['FI', 'FIN', 'Finland', 'EUROPE', 'europe/fi.json', 'finland'],
  '248': ['AX', 'ALA', 'Aland Islands', 'EUROPE', 'europe/fi.json', 'finland'],
  '250': ['FR', 'FRA', 'France', 'EUROPE', 'europe/fr.json', 'france'],
  '258': ['PF', 'PYF', 'French Polynesia', 'OCEANIA', 'australia-oceania/fp.json', 'french-polynesia'],
  '260': ['TF', 'ATF', 'French Southern and Antarctic Lands', 'ANTARCTICA', 'antarctica/fs.json', 'french-southern-and-antarctic-lands'],
  '262': ['DJ', 'DJI', 'Djibouti', 'AFRICA', 'africa/dj.json', 'djibouti'],
  '266': ['GA', 'GAB', 'Gabon', 'AFRICA', 'africa/gb.json', 'gabon'],
  '268': ['GE', 'GEO', 'Georgia', 'CENTRAL ASIA', 'central-asia/gg.json', 'georgia'],
  '270': ['GM', 'GMB', 'The Gambia', 'AFRICA', 'africa/ga.json', 'the-gambia'],
  '275': ['PS', 'PSE', 'Palestine', 'MIDDLE EAST', 'middle-east/we.json', 'west-bank'],
  '276': ['DE', 'DEU', 'Germany', 'EUROPE', 'europe/gm.json', 'germany'],
  '288': ['GH', 'GHA', 'Ghana', 'AFRICA', 'africa/gh.json', 'ghana'],
  '296': ['KI', 'KIR', 'Kiribati', 'OCEANIA', 'australia-oceania/kr.json', 'kiribati'],
  '300': ['GR', 'GRC', 'Greece', 'EUROPE', 'europe/gr.json', 'greece'],
  '304': ['GL', 'GRL', 'Greenland', 'NORTH AMERICA', 'north-america/gl.json', 'greenland'],
  '308': ['GD', 'GRD', 'Grenada', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/gj.json', 'grenada'],
  '316': ['GU', 'GUM', 'Guam', 'OCEANIA', 'australia-oceania/gq.json', 'guam'],
  '320': ['GT', 'GTM', 'Guatemala', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/gt.json', 'guatemala'],
  '324': ['GN', 'GIN', 'Guinea', 'AFRICA', 'africa/gv.json', 'guinea'],
  '328': ['GY', 'GUY', 'Guyana', 'SOUTH AMERICA', 'south-america/gy.json', 'guyana'],
  '332': ['HT', 'HTI', 'Haiti', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/ha.json', 'haiti'],
  '334': ['HM', 'HMD', 'Heard Island and McDonald Islands', 'ANTARCTICA', 'antarctica/hm.json', 'heard-island-and-mcdonald-islands'],
  '336': ['VA', 'VAT', 'Vatican City', 'EUROPE', 'europe/vt.json', 'holy-see-vatican-city'],
  '340': ['HN', 'HND', 'Honduras', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/ho.json', 'honduras'],
  '344': ['HK', 'HKG', 'Hong Kong', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/hk.json', 'hong-kong'],
  '348': ['HU', 'HUN', 'Hungary', 'EUROPE', 'europe/hu.json', 'hungary'],
  '352': ['IS', 'ISL', 'Iceland', 'EUROPE', 'europe/ic.json', 'iceland'],
  '356': ['IN', 'IND', 'India', 'SOUTH ASIA', 'south-asia/in.json', 'india'],
  '360': ['ID', 'IDN', 'Indonesia', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/id.json', 'indonesia'],
  '364': ['IR', 'IRN', 'Iran', 'MIDDLE EAST', 'middle-east/ir.json', 'iran'],
  '368': ['IQ', 'IRQ', 'Iraq', 'MIDDLE EAST', 'middle-east/iz.json', 'iraq'],
  '372': ['IE', 'IRL', 'Ireland', 'EUROPE', 'europe/ei.json', 'ireland'],
  '376': ['IL', 'ISR', 'Israel', 'MIDDLE EAST', 'middle-east/is.json', 'israel'],
  '380': ['IT', 'ITA', 'Italy', 'EUROPE', 'europe/it.json', 'italy'],
  '384': ['CI', 'CIV', "Cote d'Ivoire", 'AFRICA', 'africa/iv.json', 'c-ocirc-te-divoire'],
  '388': ['JM', 'JAM', 'Jamaica', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/jm.json', 'jamaica'],
  '392': ['JP', 'JPN', 'Japan', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/ja.json', 'japan'],
  '398': ['KZ', 'KAZ', 'Kazakhstan', 'CENTRAL ASIA', 'central-asia/kz.json', 'kazakhstan'],
  '400': ['JO', 'JOR', 'Jordan', 'MIDDLE EAST', 'middle-east/jo.json', 'jordan'],
  '404': ['KE', 'KEN', 'Kenya', 'AFRICA', 'africa/ke.json', 'kenya'],
  '408': ['KP', 'PRK', 'North Korea', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/kn.json', 'north-korea'],
  '410': ['KR', 'KOR', 'South Korea', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/ks.json', 'south-korea'],
  '414': ['KW', 'KWT', 'Kuwait', 'MIDDLE EAST', 'middle-east/ku.json', 'kuwait'],
  '417': ['KG', 'KGZ', 'Kyrgyzstan', 'CENTRAL ASIA', 'central-asia/kg.json', 'kyrgyzstan'],
  '418': ['LA', 'LAO', 'Laos', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/la.json', 'laos'],
  '422': ['LB', 'LBN', 'Lebanon', 'MIDDLE EAST', 'middle-east/le.json', 'lebanon'],
  '426': ['LS', 'LSO', 'Lesotho', 'AFRICA', 'africa/lt.json', 'lesotho'],
  '428': ['LV', 'LVA', 'Latvia', 'EUROPE', 'europe/lg.json', 'latvia'],
  '430': ['LR', 'LBR', 'Liberia', 'AFRICA', 'africa/li.json', 'liberia'],
  '434': ['LY', 'LBY', 'Libya', 'AFRICA', 'africa/ly.json', 'libya'],
  '438': ['LI', 'LIE', 'Liechtenstein', 'EUROPE', 'europe/ls.json', 'liechtenstein'],
  '440': ['LT', 'LTU', 'Lithuania', 'EUROPE', 'europe/lh.json', 'lithuania'],
  '442': ['LU', 'LUX', 'Luxembourg', 'EUROPE', 'europe/lu.json', 'luxembourg'],
  '446': ['MO', 'MAC', 'Macau', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/mc.json', 'macau'],
  '450': ['MG', 'MDG', 'Madagascar', 'AFRICA', 'africa/ma.json', 'madagascar'],
  '454': ['MW', 'MWI', 'Malawi', 'AFRICA', 'africa/mi.json', 'malawi'],
  '458': ['MY', 'MYS', 'Malaysia', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/my.json', 'malaysia'],
  '462': ['MV', 'MDV', 'Maldives', 'SOUTH ASIA', 'south-asia/mv.json', 'maldives'],
  '466': ['ML', 'MLI', 'Mali', 'AFRICA', 'africa/ml.json', 'mali'],
  '470': ['MT', 'MLT', 'Malta', 'EUROPE', 'europe/mt.json', 'malta'],
  '478': ['MR', 'MRT', 'Mauritania', 'AFRICA', 'africa/mr.json', 'mauritania'],
  '480': ['MU', 'MUS', 'Mauritius', 'AFRICA', 'africa/mp.json', 'mauritius'],
  '484': ['MX', 'MEX', 'Mexico', 'NORTH AMERICA', 'north-america/mx.json', 'mexico'],
  '492': ['MC', 'MCO', 'Monaco', 'EUROPE', 'europe/mn.json', 'monaco'],
  '496': ['MN', 'MNG', 'Mongolia', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/mg.json', 'mongolia'],
  '498': ['MD', 'MDA', 'Moldova', 'EUROPE', 'europe/md.json', 'moldova'],
  '499': ['ME', 'MNE', 'Montenegro', 'EUROPE', 'europe/mj.json', 'montenegro'],
  '500': ['MS', 'MSR', 'Montserrat', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/mh.json', 'montserrat'],
  '504': ['MA', 'MAR', 'Morocco', 'AFRICA', 'africa/mo.json', 'morocco'],
  '508': ['MZ', 'MOZ', 'Mozambique', 'AFRICA', 'africa/mz.json', 'mozambique'],
  '512': ['OM', 'OMN', 'Oman', 'MIDDLE EAST', 'middle-east/mu.json', 'oman'],
  '516': ['NA', 'NAM', 'Namibia', 'AFRICA', 'africa/wa.json', 'namibia'],
  '520': ['NR', 'NRU', 'Nauru', 'OCEANIA', 'australia-oceania/nr.json', 'nauru'],
  '524': ['NP', 'NPL', 'Nepal', 'SOUTH ASIA', 'south-asia/np.json', 'nepal'],
  '528': ['NL', 'NLD', 'Netherlands', 'EUROPE', 'europe/nl.json', 'netherlands'],
  '531': ['CW', 'CUW', 'Curacao', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/uc.json', 'curacao'],
  '533': ['AW', 'ABW', 'Aruba', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/aa.json', 'aruba'],
  '534': ['SX', 'SXM', 'Sint Maarten', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/nn.json', 'sint-maarten'],
  '540': ['NC', 'NCL', 'New Caledonia', 'OCEANIA', 'australia-oceania/nc.json', 'new-caledonia'],
  '548': ['VU', 'VUT', 'Vanuatu', 'OCEANIA', 'australia-oceania/nh.json', 'vanuatu'],
  '554': ['NZ', 'NZL', 'New Zealand', 'OCEANIA', 'australia-oceania/nz.json', 'new-zealand'],
  '558': ['NI', 'NIC', 'Nicaragua', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/nu.json', 'nicaragua'],
  '562': ['NE', 'NER', 'Niger', 'AFRICA', 'africa/ng.json', 'niger'],
  '566': ['NG', 'NGA', 'Nigeria', 'AFRICA', 'africa/ni.json', 'nigeria'],
  '570': ['NU', 'NIU', 'Niue', 'OCEANIA', 'australia-oceania/ne.json', 'niue'],
  '574': ['NF', 'NFK', 'Norfolk Island', 'OCEANIA', 'australia-oceania/nf.json', 'norfolk-island'],
  '578': ['NO', 'NOR', 'Norway', 'EUROPE', 'europe/no.json', 'norway'],
  '580': ['MP', 'MNP', 'Northern Mariana Islands', 'OCEANIA', 'australia-oceania/cq.json', 'northern-mariana-islands'],
  '583': ['FM', 'FSM', 'Micronesia', 'OCEANIA', 'australia-oceania/fm.json', 'federated-states-of-micronesia'],
  '584': ['MH', 'MHL', 'Marshall Islands', 'OCEANIA', 'australia-oceania/rm.json', 'marshall-islands'],
  '585': ['PW', 'PLW', 'Palau', 'OCEANIA', 'australia-oceania/ps.json', 'palau'],
  '586': ['PK', 'PAK', 'Pakistan', 'SOUTH ASIA', 'south-asia/pk.json', 'pakistan'],
  '591': ['PA', 'PAN', 'Panama', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/pm.json', 'panama'],
  '598': ['PG', 'PNG', 'Papua New Guinea', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/pp.json', 'papua-new-guinea'],
  '600': ['PY', 'PRY', 'Paraguay', 'SOUTH AMERICA', 'south-america/pa.json', 'paraguay'],
  '604': ['PE', 'PER', 'Peru', 'SOUTH AMERICA', 'south-america/pe.json', 'peru'],
  '608': ['PH', 'PHL', 'Philippines', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/rp.json', 'philippines'],
  '612': ['PN', 'PCN', 'Pitcairn Islands', 'OCEANIA', 'australia-oceania/pc.json', 'pitcairn-islands'],
  '616': ['PL', 'POL', 'Poland', 'EUROPE', 'europe/pl.json', 'poland'],
  '620': ['PT', 'PRT', 'Portugal', 'EUROPE', 'europe/po.json', 'portugal'],
  '624': ['GW', 'GNB', 'Guinea-Bissau', 'AFRICA', 'africa/pu.json', 'guinea-bissau'],
  '626': ['TL', 'TLS', 'Timor-Leste', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/tt.json', 'timor-leste'],
  '630': ['PR', 'PRI', 'Puerto Rico', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/rq.json', 'puerto-rico'],
  '634': ['QA', 'QAT', 'Qatar', 'MIDDLE EAST', 'middle-east/qa.json', 'qatar'],
  '642': ['RO', 'ROU', 'Romania', 'EUROPE', 'europe/ro.json', 'romania'],
  '643': ['RU', 'RUS', 'Russia', 'CENTRAL ASIA', 'central-asia/rs.json', 'russia'],
  '646': ['RW', 'RWA', 'Rwanda', 'AFRICA', 'africa/rw.json', 'rwanda'],
  '652': ['BL', 'BLM', 'Saint Barthelemy', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/tb.json', 'saint-barthelemy'],
  '654': ['SH', 'SHN', 'Saint Helena', 'AFRICA', 'africa/sh.json', 'saint-helena-ascension-and-tristan-da-cunha'],
  '659': ['KN', 'KNA', 'Saint Kitts and Nevis', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/sc.json', 'saint-kitts-and-nevis'],
  '660': ['AI', 'AIA', 'Anguilla', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/av.json', 'anguilla'],
  '662': ['LC', 'LCA', 'Saint Lucia', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/st.json', 'saint-lucia'],
  '663': ['MF', 'MAF', 'Saint Martin', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/rn.json', 'saint-martin'],
  '666': ['PM', 'SPM', 'Saint Pierre and Miquelon', 'NORTH AMERICA', 'north-america/sb.json', 'saint-pierre-and-miquelon'],
  '670': ['VC', 'VCT', 'Saint Vincent and the Grenadines', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/vc.json', 'saint-vincent-and-the-grenadines'],
  '674': ['SM', 'SMR', 'San Marino', 'EUROPE', 'europe/sm.json', 'san-marino'],
  '678': ['ST', 'STP', 'Sao Tome and Principe', 'AFRICA', 'africa/tp.json', 'sao-tome-and-principe'],
  '682': ['SA', 'SAU', 'Saudi Arabia', 'MIDDLE EAST', 'middle-east/sa.json', 'saudi-arabia'],
  '686': ['SN', 'SEN', 'Senegal', 'AFRICA', 'africa/sg.json', 'senegal'],
  '688': ['RS', 'SRB', 'Serbia', 'EUROPE', 'europe/ri.json', 'serbia'],
  '690': ['SC', 'SYC', 'Seychelles', 'AFRICA', 'africa/se.json', 'seychelles'],
  '694': ['SL', 'SLE', 'Sierra Leone', 'AFRICA', 'africa/sl.json', 'sierra-leone'],
  '702': ['SG', 'SGP', 'Singapore', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/sn.json', 'singapore'],
  '703': ['SK', 'SVK', 'Slovakia', 'EUROPE', 'europe/lo.json', 'slovakia'],
  '704': ['VN', 'VNM', 'Vietnam', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/vm.json', 'vietnam'],
  '705': ['SI', 'SVN', 'Slovenia', 'EUROPE', 'europe/si.json', 'slovenia'],
  '706': ['SO', 'SOM', 'Somalia', 'AFRICA', 'africa/so.json', 'somalia'],
  '710': ['ZA', 'ZAF', 'South Africa', 'AFRICA', 'africa/sf.json', 'south-africa'],
  '716': ['ZW', 'ZWE', 'Zimbabwe', 'AFRICA', 'africa/zi.json', 'zimbabwe'],
  '724': ['ES', 'ESP', 'Spain', 'EUROPE', 'europe/sp.json', 'spain'],
  '728': ['SS', 'SSD', 'South Sudan', 'AFRICA', 'africa/od.json', 'south-sudan'],
  '729': ['SD', 'SDN', 'Sudan', 'AFRICA', 'africa/su.json', 'sudan'],
  '732': ['EH', 'ESH', 'Western Sahara', 'AFRICA', 'africa/wi.json', 'western-sahara'],
  '740': ['SR', 'SUR', 'Suriname', 'SOUTH AMERICA', 'south-america/ns.json', 'suriname'],
  '748': ['SZ', 'SWZ', 'Eswatini', 'AFRICA', 'africa/wz.json', 'eswatini'],
  '752': ['SE', 'SWE', 'Sweden', 'EUROPE', 'europe/sw.json', 'sweden'],
  '756': ['CH', 'CHE', 'Switzerland', 'EUROPE', 'europe/sz.json', 'switzerland'],
  '760': ['SY', 'SYR', 'Syria', 'MIDDLE EAST', 'middle-east/sy.json', 'syria'],
  '762': ['TJ', 'TJK', 'Tajikistan', 'CENTRAL ASIA', 'central-asia/ti.json', 'tajikistan'],
  '764': ['TH', 'THA', 'Thailand', 'EAST & SOUTHEAST ASIA', 'east-n-southeast-asia/th.json', 'thailand'],
  '768': ['TG', 'TGO', 'Togo', 'AFRICA', 'africa/to.json', 'togo'],
  '776': ['TO', 'TON', 'Tonga', 'OCEANIA', 'australia-oceania/tn.json', 'tonga'],
  '780': ['TT', 'TTO', 'Trinidad and Tobago', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/td.json', 'trinidad-and-tobago'],
  '784': ['AE', 'ARE', 'United Arab Emirates', 'MIDDLE EAST', 'middle-east/ae.json', 'united-arab-emirates'],
  '788': ['TN', 'TUN', 'Tunisia', 'AFRICA', 'africa/ts.json', 'tunisia'],
  '792': ['TR', 'TUR', 'Turkey', 'MIDDLE EAST', 'middle-east/tu.json', 'turkiye'],
  '795': ['TM', 'TKM', 'Turkmenistan', 'CENTRAL ASIA', 'central-asia/tx.json', 'turkmenistan'],
  '796': ['TC', 'TCA', 'Turks and Caicos Islands', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/tk.json', 'turks-and-caicos-islands'],
  '800': ['UG', 'UGA', 'Uganda', 'AFRICA', 'africa/ug.json', 'uganda'],
  '804': ['UA', 'UKR', 'Ukraine', 'EUROPE', 'europe/up.json', 'ukraine'],
  '807': ['MK', 'MKD', 'North Macedonia', 'EUROPE', 'europe/mk.json', 'north-macedonia'],
  '818': ['EG', 'EGY', 'Egypt', 'AFRICA', 'africa/eg.json', 'egypt'],
  '826': ['GB', 'GBR', 'United Kingdom', 'EUROPE', 'europe/uk.json', 'united-kingdom'],
  '831': ['GG', 'GGY', 'Guernsey', 'EUROPE', 'europe/gk.json', 'guernsey'],
  '832': ['JE', 'JEY', 'Jersey', 'EUROPE', 'europe/je.json', 'jersey'],
  '833': ['IM', 'IMN', 'Isle of Man', 'EUROPE', 'europe/im.json', 'isle-of-man'],
  '834': ['TZ', 'TZA', 'Tanzania', 'AFRICA', 'africa/tz.json', 'tanzania'],
  '840': ['US', 'USA', 'United States', 'NORTH AMERICA', 'north-america/us.json', 'united-states'],
  '850': ['VI', 'VIR', 'U.S. Virgin Islands', 'CENTRAL AMERICA & CARIBBEAN', 'central-america-n-caribbean/vq.json', 'virgin-islands'],
  '854': ['BF', 'BFA', 'Burkina Faso', 'AFRICA', 'africa/uv.json', 'burkina-faso'],
  '858': ['UY', 'URY', 'Uruguay', 'SOUTH AMERICA', 'south-america/uy.json', 'uruguay'],
  '860': ['UZ', 'UZB', 'Uzbekistan', 'CENTRAL ASIA', 'central-asia/uz.json', 'uzbekistan'],
  '862': ['VE', 'VEN', 'Venezuela', 'SOUTH AMERICA', 'south-america/ve.json', 'venezuela'],
  '876': ['WF', 'WLF', 'Wallis and Futuna', 'OCEANIA', 'australia-oceania/wf.json', 'wallis-and-futuna'],
  '882': ['WS', 'WSM', 'Samoa', 'OCEANIA', 'australia-oceania/ws.json', 'samoa'],
  '887': ['YE', 'YEM', 'Yemen', 'MIDDLE EAST', 'middle-east/ym.json', 'yemen'],
  '894': ['ZM', 'ZMB', 'Zambia', 'AFRICA', 'africa/za.json', 'zambia'],
};

// Special world-atlas geometries lacking a unique ISO numeric ID or sharing one
const COUNTRY_META_BY_ATLAS_NAME = {
  'Ashmore and Cartier Is.': [
    null,
    null,
    'Ashmore and Cartier Islands',
    'OCEANIA',
    'australia-oceania/at.json',
    'ashmore-and-cartier-islands',
    'country-ashmore-cartier',
  ],
  Kosovo: ['XK', 'XKX', 'Kosovo', 'EUROPE', 'europe/kv.json', 'kosovo', 'country-xk'],
  Somaliland: [null, null, 'Somaliland', 'AFRICA', 'africa/so.json', 'somalia', 'country-somaliland'],
  'N. Cyprus': [null, null, 'Northern Cyprus', 'EUROPE', 'europe/cy.json', 'cyprus', 'country-n-cyprus'],
  'Indian Ocean Ter.': [
    null,
    null,
    'Australian Indian Ocean Territories',
    'OCEANIA',
    'australia-oceania/ck.json',
    'cocos-keeling-islands',
    'country-indian-ocean-ter',
  ],
  'Siachen Glacier': [null, null, 'Siachen Glacier', 'SOUTH ASIA', null, null, 'country-siachen-glacier'],
};

// ----------------------------------------------------------------------------
// Spatial Geometry Helpers
// ----------------------------------------------------------------------------
function normalizeLon(lon) {
  if (!Number.isFinite(lon)) return 0;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === -180 && lon > 0) x = 180;
  return x;
}

function computePrimaryCentroid(geoFeature) {
  const geom = geoFeature?.geometry;
  if (!geom) return [0, 0];

  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
    let largestArea = -1;
    let largestPoly = null;
    for (const polyCoords of geom.coordinates) {
      const poly = { type: 'Polygon', coordinates: polyCoords };
      const a = geoArea(poly);
      if (Number.isFinite(a) && a > largestArea) {
        largestArea = a;
        largestPoly = poly;
      }
    }
    if (largestPoly) {
      const c = geoCentroid(largestPoly);
      if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
        return c;
      }
    }
  }

  const fallback = geoCentroid(geoFeature);
  return [
    Number.isFinite(fallback[0]) ? fallback[0] : 0,
    Number.isFinite(fallback[1]) ? fallback[1] : 0,
  ];
}

function computeBoundingBox(geoFeature) {
  const [[minLon, minLat], [maxLon, maxLat]] = geoBounds(geoFeature);
  return {
    minLon,
    maxLon,
    minLat,
    maxLat,
    crossesAntimeridian: minLon > maxLon,
  };
}

function pointInBbox(lon, lat, bbox) {
  if (lat < bbox.minLat || lat > bbox.maxLat) return false;
  if (bbox.crossesAntimeridian) {
    return lon >= bbox.minLon || lon <= bbox.maxLon;
  }
  return lon >= bbox.minLon && lon <= bbox.maxLon;
}

// ----------------------------------------------------------------------------
// Build Indexed Country Spatial Features
// ----------------------------------------------------------------------------
const rawAtlasFeatures = feature(worldTopo50, worldTopo50.objects.countries).features;

export const COUNTRY_FEATURES = rawAtlasFeatures.map((geoFeature) => {
  const atlasName = geoFeature.properties?.name || 'Unknown';
  const rawId = geoFeature.id != null ? String(geoFeature.id) : null;

  const special = COUNTRY_META_BY_ATLAS_NAME[atlasName];
  const meta = special || (rawId ? COUNTRY_META_BY_NUMERIC[rawId] : null);

  const iso2 = meta ? meta[0] : null;
  const iso3 = meta ? meta[1] : null;
  const name = meta ? meta[2] : atlasName;
  const region = meta ? meta[3] : 'GLOBAL';
  const factbookPath = meta ? meta[4] : null;
  const ciaSlug = meta ? meta[5] : null;
  const explicitId = special ? special[6] : null;

  const slugFallback = atlasName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = explicitId || `country-${(iso2 || rawId || slugFallback).toLowerCase()}`;

  const [lon, lat] = computePrimaryCentroid(geoFeature);
  const bbox = computeBoundingBox(geoFeature);
  const area = geoArea(geoFeature);

  return {
    id,
    isoNumeric: special ? null : rawId,
    iso2,
    iso3,
    name,
    atlasName,
    region,
    lat: +lat.toFixed(4),
    lon: +lon.toFixed(4),
    area,
    bbox,
    feature: geoFeature,
    factbookPath,
    ciaSlug,
    openFactbookSlug: ciaSlug,
  };
});

// Pre-sort a spatial lookup copy by ascending polygon area so enclaves & tiny
// microstates (e.g. Lesotho, Vatican, San Marino, Singapore, Palestine) always
// take precedence if low-res coastal/border polygons slightly touch.
const SPATIAL_INDEX_ASC = [...COUNTRY_FEATURES].sort((a, b) => a.area - b.area);

// ----------------------------------------------------------------------------
// Spatial Point-in-Polygon Country Lookup (<0.2ms average via bbox prefilter)
// ----------------------------------------------------------------------------
export function findCountryAtLonLat(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90) return null;
  const normLon = normalizeLon(lon);
  const pt = [normLon, lat];

  for (let i = 0; i < SPATIAL_INDEX_ASC.length; i++) {
    const rec = SPATIAL_INDEX_ASC[i];
    if (!pointInBbox(normLon, lat, rec.bbox)) continue;
    if (geoContains(rec.feature, pt)) {
      return rec;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Code / Name / Alias Lookup Tables
// ----------------------------------------------------------------------------
function normalizeKey(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BY_ID = new Map();
const BY_ISO2 = new Map();
const BY_ISO3 = new Map();
const BY_NUMERIC = new Map();
const BY_NORM_NAME = new Map();

for (const rec of COUNTRY_FEATURES) {
  BY_ID.set(rec.id.toLowerCase(), rec);
  if (rec.iso2) BY_ISO2.set(rec.iso2.toUpperCase(), rec);
  if (rec.iso3) BY_ISO3.set(rec.iso3.toUpperCase(), rec);
  if (rec.isoNumeric) BY_NUMERIC.set(rec.isoNumeric, rec);
  BY_NORM_NAME.set(normalizeKey(rec.name), rec);
  if (rec.atlasName) {
    const k = normalizeKey(rec.atlasName);
    if (!BY_NORM_NAME.has(k)) BY_NORM_NAME.set(k, rec);
  }
  if (rec.ciaSlug) {
    const k = normalizeKey(rec.ciaSlug);
    if (!BY_NORM_NAME.has(k)) BY_NORM_NAME.set(k, rec);
  }
}

const COUNTRY_ALIASES = {
  usa: 'US',
  'u s': 'US',
  'u s a': 'US',
  'united states of america': 'US',
  america: 'US',
  us: 'US',
  uk: 'GB',
  'u k': 'GB',
  britain: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  uae: 'AE',
  'u a e': 'AE',
  emirates: 'AE',
  'russian federation': 'RU',
  'islamic republic of iran': 'IR',
  'republic of korea': 'KR',
  rok: 'KR',
  'korea south': 'KR',
  'dprk': 'KP',
  'korea north': 'KP',
  'democratic peoples republic of korea': 'KP',
  'ivory coast': 'CI',
  'cote divoire': 'CI',
  drc: 'CD',
  'dr congo': 'CD',
  'dem rep congo': 'CD',
  'dem rep of the congo': 'CD',
  'democratic republic of congo': 'CD',
  'congo kinshasa': 'CD',
  'congo democratic republic of the': 'CD',
  zaire: 'CD',
  congo: 'CG',
  'congo brazzaville': 'CG',
  'congo republic of the': 'CG',
  'rep of congo': 'CG',
  'czech republic': 'CZ',
  turkiye: 'TR',
  'turkey turkiye': 'TR',
  burma: 'MM',
  swaziland: 'SZ',
  'cape verde': 'CV',
  'east timor': 'TL',
  'timor leste': 'TL',
  macedonia: 'MK',
  fyrom: 'MK',
  bosnia: 'BA',
  'bosnia and herz': 'BA',
  'bosnia herzegovina': 'BA',
  holland: 'NL',
  'the netherlands': 'NL',
  prc: 'CN',
  'peoples republic of china': 'CN',
  roc: 'TW',
  'republic of china': 'TW',
  'chinese taipei': 'TW',
  'palestinian territories': 'PS',
  'state of palestine': 'PS',
  gaza: 'PS',
  'gaza strip': 'PS',
  'west bank': 'PS',
  'syrian arab republic': 'SY',
  'viet nam': 'VN',
  'lao pdr': 'LA',
  'brunei darussalam': 'BN',
  'plurinational state of bolivia': 'BO',
  'bolivarian republic of venezuela': 'VE',
  'united republic of tanzania': 'TZ',
  'republic of moldova': 'MD',
  's sudan': 'SS',
  'central african rep': 'CF',
  car: 'CF',
  'eq guinea': 'GQ',
  'dominican rep': 'DO',
  'solomon is': 'SB',
  'falkland is': 'FK',
  malvinas: 'FK',
  'islas malvinas': 'FK',
  vatican: 'VA',
  'holy see': 'VA',
  gambia: 'GM',
  'gambia the': 'GM',
  'the bahamas': 'BS',
  'bahamas the': 'BS',
  'federated states of micronesia': 'FM',
  'micronesia federated states of': 'FM',
  fsm: 'FM',
  'sao tome': 'ST',
  trinidad: 'TT',
  antigua: 'AG',
  'antigua and barb': 'AG',
  'st kitts': 'KN',
  'saint kitts': 'KN',
  'st kitts and nevis': 'KN',
  'st lucia': 'LC',
  'st vincent': 'VC',
  'saint vincent': 'VC',
  'st vin and gren': 'VC',
  png: 'PG',
  aotearoa: 'NZ',
  rsa: 'ZA',
  ksa: 'SA',
  saudi: 'SA',
  'w sahara': 'EH',
  macao: 'MO',
  'faroe is': 'FO',
  'faeroe is': 'FO',
  'us virgin islands': 'VI',
  'u s virgin is': 'VI',
  'virgin islands': 'VI',
  'british virgin is': 'VG',
  'cayman is': 'KY',
  'turks and caicos is': 'TC',
  'marshall is': 'MH',
  'n mariana is': 'MP',
  'cook is': 'CK',
  'pitcairn is': 'PN',
  'fr polynesia': 'PF',
  'wallis and futuna is': 'WF',
  'st pierre and miquelon': 'PM',
  'st martin': 'MF',
  'st barthelemy': 'BL',
  'n cyprus': 'country-n-cyprus',
  'northern cyprus': 'country-n-cyprus',
  somaliland: 'country-somaliland',
  aland: 'AX',
};

export function findCountryByCodeOrName(query) {
  if (query == null) return null;
  if (typeof query === 'object' && query.id && BY_ID.has(String(query.id).toLowerCase())) {
    return BY_ID.get(String(query.id).toLowerCase());
  }
  const raw = String(query).trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (BY_ID.has(lower)) return BY_ID.get(lower);

  const upper = raw.toUpperCase();
  if (upper.length === 2 && BY_ISO2.has(upper)) return BY_ISO2.get(upper);
  if (upper.length === 3 && BY_ISO3.has(upper)) return BY_ISO3.get(upper);
  if (/^\d{1,3}$/.test(raw)) {
    const padded = raw.padStart(3, '0');
    if (BY_NUMERIC.has(padded)) return BY_NUMERIC.get(padded);
  }

  const norm = normalizeKey(raw);
  if (!norm) return null;
  if (BY_NORM_NAME.has(norm)) return BY_NORM_NAME.get(norm);

  const aliasTarget = COUNTRY_ALIASES[norm];
  if (aliasTarget) {
    return BY_ISO2.get(aliasTarget) || BY_ID.get(aliasTarget) || null;
  }

  return null;
}

// ----------------------------------------------------------------------------
// Headline / OSINT Text Geocoder (Country names, capitals, major cities, demonyms)
// ----------------------------------------------------------------------------
// Case-sensitive abbreviations matched separately so lowercase English words
// ("us", "uk") never false-positive.
const CASE_SENSITIVE_GAZETTEER = [
  ['U.S.A.', 'US'],
  ['U.S.', 'US'],
  ['USA', 'US'],
  ['U.K.', 'GB'],
  ['UK', 'GB'],
  ['UAE', 'AE'],
  ['U.A.E.', 'AE'],
  ['DRC', 'CD'],
  ['DPRK', 'KP'],
  ['IDF', 'IL'],
  ['IRGC', 'IR'],
  ['PLA', 'CN'],
];

// Case-insensitive keywords -> ISO-2 (sorted longest-first at init time)
const GEOCODE_KEYWORDS_BY_ISO2 = {
  US: ['united states', 'washington', 'pentagon', 'white house', 'new york', 'california', 'texas', 'florida', 'chicago', 'los angeles', 'san francisco', 'seattle', 'boston', 'alaska', 'hawaii', 'american', 'americans'],
  GB: ['united kingdom', 'great britain', 'britain', 'british', 'england', 'scotland', 'wales', 'northern ireland', 'london', 'westminster', 'downing street', 'manchester', 'edinburgh', 'belfast', 'glasgow'],
  FR: ['france', 'french', 'paris', 'marseille', 'lyon', 'toulouse', 'nice', 'elysee'],
  DE: ['germany', 'german', 'berlin', 'munich', 'frankfurt', 'hamburg', 'cologne', 'stuttgart', 'bundestag'],
  IT: ['italy', 'italian', 'rome', 'milan', 'naples', 'venice', 'turin', 'sicily'],
  ES: ['spain', 'spanish', 'madrid', 'barcelona', 'valencia', 'seville', 'catalonia'],
  PT: ['portugal', 'portuguese', 'lisbon', 'porto'],
  NL: ['netherlands', 'dutch', 'amsterdam', 'rotterdam', 'the hague', 'eindhoven'],
  BE: ['belgium', 'belgian', 'brussels', 'antwerp'],
  CH: ['switzerland', 'swiss', 'zurich', 'geneva', 'bern', 'basel', 'davos'],
  AT: ['austria', 'austrian', 'vienna', 'salzburg'],
  SE: ['sweden', 'swedish', 'stockholm', 'gothenburg', 'malmo'],
  NO: ['norway', 'norwegian', 'oslo', 'bergen', 'stavanger', 'svalbard'],
  FI: ['finland', 'finnish', 'helsinki'],
  DK: ['denmark', 'danish', 'copenhagen'],
  GL: ['greenland', 'nuuk'],
  IS: ['iceland', 'icelandic', 'reykjavik'],
  IE: ['ireland', 'irish', 'dublin', 'cork'],
  PL: ['poland', 'polish', 'warsaw', 'krakow', 'gdansk'],
  CZ: ['czechia', 'czech republic', 'czech', 'prague'],
  SK: ['slovakia', 'slovak', 'bratislava'],
  HU: ['hungary', 'hungarian', 'budapest'],
  RO: ['romania', 'romanian', 'bucharest'],
  BG: ['bulgaria', 'bulgarian', 'sofia'],
  GR: ['greece', 'greek', 'athens', 'thessaloniki', 'crete'],
  CY: ['cyprus', 'cypriot', 'nicosia'],
  UA: ['ukraine', 'ukrainian', 'kyiv', 'kiev', 'kharkiv', 'odesa', 'odessa', 'dnipro', 'lviv', 'donetsk', 'luhansk', 'crimea', 'zaporizhzhia', 'kherson', 'mariupol', 'donbas'],
  RU: ['russia', 'russian', 'moscow', 'kremlin', 'st petersburg', 'saint petersburg', 'siberia', 'vladivostok', 'kaliningrad', 'chechnya', 'belgorod', 'kursk', 'kamchatka'],
  BY: ['belarus', 'belarusian', 'minsk'],
  MD: ['moldova', 'moldovan', 'chisinau', 'transnistria'],
  EE: ['estonia', 'estonian', 'tallinn'],
  LV: ['latvia', 'latvian', 'riga'],
  LT: ['lithuania', 'lithuanian', 'vilnius'],
  RS: ['serbia', 'serbian', 'belgrade'],
  HR: ['croatia', 'croatian', 'zagreb'],
  SI: ['slovenia', 'slovenian', 'ljubljana'],
  BA: ['bosnia and herzegovina', 'bosnia', 'bosnian', 'sarajevo'],
  ME: ['montenegro', 'montenegrin', 'podgorica'],
  MK: ['north macedonia', 'macedonian', 'skopje'],
  AL: ['albania', 'albanian', 'tirana'],
  XK: ['kosovo', 'kosovar', 'pristina'],
  LU: ['luxembourg'],
  MT: ['malta', 'maltese', 'valletta'],
  MC: ['monaco'],
  VA: ['vatican', 'vatican city', 'holy see'],
  SM: ['san marino'],
  AD: ['andorra'],
  LI: ['liechtenstein'],
  TR: ['turkey', 'turkiye', 'turkish', 'ankara', 'istanbul', 'izmir', 'antalya'],
  IL: ['israel', 'israeli', 'jerusalem', 'tel aviv', 'haifa', 'negev', 'golan'],
  PS: ['palestine', 'palestinian', 'gaza', 'gaza strip', 'rafah', 'khan younis', 'west bank', 'ramallah', 'nablus', 'jenin'],
  LB: ['lebanon', 'lebanese', 'beirut', 'hezbollah', 'sidon', 'tyre'],
  SY: ['syria', 'syrian', 'damascus', 'aleppo', 'idlib', 'latakia', 'homs'],
  JO: ['jordan', 'jordanian', 'amman', 'aqaba'],
  IQ: ['iraq', 'iraqi', 'baghdad', 'mosul', 'basra', 'erbil', 'kirkuk'],
  IR: ['iran', 'iranian', 'tehran', 'isfahan', 'tabriz', 'mashhad', 'shiraz', 'natanz', 'hormuz'],
  SA: ['saudi arabia', 'saudi', 'riyadh', 'jeddah', 'mecca', 'medina', 'dammam', 'neom'],
  AE: ['united arab emirates', 'dubai', 'abu dhabi', 'sharjah', 'emirati'],
  QA: ['qatar', 'qatari', 'doha'],
  KW: ['kuwait', 'kuwaiti', 'kuwait city'],
  BH: ['bahrain', 'bahraini', 'manama'],
  OM: ['oman', 'omani', 'muscat'],
  YE: ['yemen', 'yemeni', 'sanaa', 'aden', 'houthi', 'houthis', 'hodeidah', 'bab el mandeb'],
  GE: ['georgia', 'georgian', 'tbilisi', 'batumi'],
  AM: ['armenia', 'armenian', 'yerevan'],
  AZ: ['azerbaijan', 'azerbaijani', 'baku'],
  KZ: ['kazakhstan', 'kazakh', 'astana', 'almaty', 'baikonur'],
  UZ: ['uzbekistan', 'uzbek', 'tashkent', 'samarkand'],
  KG: ['kyrgyzstan', 'kyrgyz', 'bishkek'],
  TJ: ['tajikistan', 'tajik', 'dushanbe'],
  TM: ['turkmenistan', 'turkmen', 'ashgabat'],
  CN: ['china', 'chinese', 'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'chengdu', 'wuhan', 'chongqing', 'xinjiang', 'tibet', 'tianjin', 'nanjing', 'hangzhou', 'south china sea'],
  TW: ['taiwan', 'taiwanese', 'taipei', 'kaohsiung', 'tsmc', 'taiwan strait'],
  HK: ['hong kong'],
  MO: ['macau', 'macao'],
  JP: ['japan', 'japanese', 'tokyo', 'osaka', 'kyoto', 'yokohama', 'okinawa', 'fukushima', 'hokkaido', 'nagasaki', 'hiroshima'],
  KR: ['south korea', 'south korean', 'seoul', 'busan', 'incheon', 'daegu'],
  KP: ['north korea', 'north korean', 'pyongyang'],
  MN: ['mongolia', 'mongolian', 'ulaanbaatar'],
  IN: ['india', 'indian', 'new delhi', 'delhi', 'mumbai', 'bengaluru', 'bangalore', 'chennai', 'kolkata', 'hyderabad', 'pune', 'ahmedabad', 'kashmir', 'ladakh'],
  PK: ['pakistan', 'pakistani', 'islamabad', 'karachi', 'lahore', 'peshawar', 'quetta', 'balochistan'],
  AF: ['afghanistan', 'afghan', 'kabul', 'kandahar', 'herat', 'taliban'],
  BD: ['bangladesh', 'bangladeshi', 'dhaka', 'chittagong'],
  LK: ['sri lanka', 'sri lankan', 'colombo'],
  NP: ['nepal', 'nepali', 'nepalese', 'kathmandu'],
  BT: ['bhutan', 'bhutanese', 'thimphu'],
  MV: ['maldives', 'maldivian'],
  MM: ['myanmar', 'burma', 'burmese', 'yangon', 'naypyidaw', 'mandalay', 'rakhine'],
  TH: ['thailand', 'thai', 'bangkok', 'phuket', 'chiang mai'],
  VN: ['vietnam', 'vietnamese', 'hanoi', 'ho chi minh', 'saigon', 'da nang'],
  KH: ['cambodia', 'cambodian', 'phnom penh'],
  LA: ['laos', 'laotian', 'vientiane'],
  MY: ['malaysia', 'malaysian', 'kuala lumpur', 'penang', 'sabah', 'sarawak'],
  SG: ['singapore', 'singaporean'],
  ID: ['indonesia', 'indonesian', 'jakarta', 'bali', 'surabaya', 'sumatra', 'java', 'sulawesi', 'papua'],
  PH: ['philippines', 'philippine', 'filipino', 'manila', 'cebu', 'mindanao', 'luzon', 'davao'],
  BN: ['brunei', 'bandar seri begawan'],
  TL: ['timor-leste', 'timor leste', 'east timor', 'dili'],
  PG: ['papua new guinea', 'port moresby'],
  AU: ['australia', 'australian', 'canberra', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide', 'darwin'],
  NZ: ['new zealand', 'wellington', 'auckland', 'christchurch'],
  FJ: ['fiji', 'fijian', 'suva'],
  SB: ['solomon islands', 'honiara'],
  VU: ['vanuatu', 'port vila'],
  WS: ['samoa', 'samoan', 'apia'],
  TO: ['tonga', 'tongan', 'nukualofa'],
  KI: ['kiribati', 'tarawa'],
  GU: ['guam'],
  NC: ['new caledonia', 'noumea'],
  PF: ['french polynesia', 'tahiti'],
  EG: ['egypt', 'egyptian', 'cairo', 'alexandria', 'suez', 'suez canal', 'sinai', 'giza'],
  LY: ['libya', 'libyan', 'tripoli', 'benghazi'],
  TN: ['tunisia', 'tunisian', 'tunis'],
  DZ: ['algeria', 'algerian', 'algiers', 'oran'],
  MA: ['morocco', 'moroccan', 'rabat', 'casablanca', 'marrakesh', 'tangier'],
  EH: ['western sahara'],
  SD: ['sudan', 'sudanese', 'khartoum', 'darfur', 'omdurman', 'port sudan'],
  SS: ['south sudan', 'south sudanese', 'juba'],
  ET: ['ethiopia', 'ethiopian', 'addis ababa', 'tigray', 'amhara'],
  ER: ['eritrea', 'eritrean', 'asmara'],
  DJ: ['djibouti'],
  SO: ['somalia', 'somali', 'mogadishu', 'al-shabaab', 'puntland'],
  KE: ['kenya', 'kenyan', 'nairobi', 'mombasa'],
  UG: ['uganda', 'ugandan', 'kampala'],
  TZ: ['tanzania', 'tanzanian', 'dar es salaam', 'dodoma', 'zanzibar'],
  RW: ['rwanda', 'rwandan', 'kigali'],
  BI: ['burundi', 'burundian', 'bujumbura'],
  CD: ['democratic republic of the congo', 'dr congo', 'congolese', 'kinshasa', 'goma', 'lubumbashi', 'kivu'],
  CG: ['republic of the congo', 'brazzaville'],
  NG: ['nigeria', 'nigerian', 'lagos', 'abuja', 'kano', 'port harcourt', 'boko haram'],
  GH: ['ghana', 'ghanaian', 'accra', 'kumasi'],
  CI: ['cote d ivoire', "cote d'ivoire", 'ivory coast', 'ivorian', 'abidjan', 'yamoussoukro'],
  SN: ['senegal', 'senegalese', 'dakar'],
  ML: ['mali', 'malian', 'bamako', 'timbuktu'],
  NE: ['niger', 'nigerien', 'niamey'],
  BF: ['burkina faso', 'burkinabe', 'ouagadougou'],
  TD: ['chad', 'chadian', 'ndjamena', "n'djamena"],
  CM: ['cameroon', 'cameroonian', 'yaounde', 'douala'],
  CF: ['central african republic', 'bangui'],
  GA: ['gabon', 'gabonese', 'libreville'],
  GQ: ['equatorial guinea', 'malabo'],
  AO: ['angola', 'angolan', 'luanda'],
  ZM: ['zambia', 'zambian', 'lusaka'],
  ZW: ['zimbabwe', 'zimbabwean', 'harare'],
  MZ: ['mozambique', 'mozambican', 'maputo', 'cabo delgado'],
  MW: ['malawi', 'malawian', 'lilongwe'],
  MG: ['madagascar', 'malagasy', 'antananarivo'],
  ZA: ['south africa', 'south african', 'johannesburg', 'cape town', 'pretoria', 'durban'],
  NA: ['namibia', 'namibian', 'windhoek'],
  BW: ['botswana', 'gaborone'],
  LS: ['lesotho', 'maseru'],
  SZ: ['eswatini', 'swaziland', 'mbabane'],
  GN: ['guinea', 'conakry'],
  GW: ['guinea-bissau', 'bissau'],
  SL: ['sierra leone', 'freetown'],
  LR: ['liberia', 'liberian', 'monrovia'],
  MR: ['mauritania', 'mauritanian', 'nouakchott'],
  GM: ['the gambia', 'gambia', 'banjul'],
  TG: ['togo', 'togolese', 'lome'],
  BJ: ['benin', 'beninese', 'cotonou'],
  CV: ['cabo verde', 'cape verde', 'praia'],
  MU: ['mauritius', 'port louis'],
  SC: ['seychelles'],
  KM: ['comoros', 'moroni'],
  CA: ['canada', 'canadian', 'ottawa', 'toronto', 'vancouver', 'montreal', 'calgary', 'quebec', 'alberta', 'ontario'],
  MX: ['mexico', 'mexican', 'mexico city', 'guadalajara', 'monterrey', 'tijuana', 'cancun', 'sinaloa', 'oaxaca'],
  GT: ['guatemala', 'guatemalan', 'guatemala city'],
  BZ: ['belize', 'belizean'],
  HN: ['honduras', 'honduran', 'tegucigalpa'],
  SV: ['el salvador', 'salvadoran', 'san salvador'],
  NI: ['nicaragua', 'nicaraguan', 'managua'],
  CR: ['costa rica', 'costa rican', 'san jose'],
  PA: ['panama', 'panamanian', 'panama city', 'panama canal'],
  CU: ['cuba', 'cuban', 'havana'],
  JM: ['jamaica', 'jamaican', 'kingston'],
  HT: ['haiti', 'haitian', 'port-au-prince', 'port au prince'],
  DO: ['dominican republic', 'santo domingo'],
  PR: ['puerto rico', 'puerto rican', 'san juan'],
  TT: ['trinidad and tobago', 'trinidad', 'port of spain'],
  BS: ['bahamas', 'bahamian', 'nassau'],
  BB: ['barbados', 'bridgetown'],
  CO: ['colombia', 'colombian', 'bogota', 'medellin', 'cali', 'cartagena'],
  VE: ['venezuela', 'venezuelan', 'caracas', 'maracaibo'],
  EC: ['ecuador', 'ecuadorian', 'quito', 'guayaquil', 'galapagos'],
  PE: ['peru', 'peruvian', 'lima', 'cusco', 'arequipa'],
  BO: ['bolivia', 'bolivian', 'la paz', 'sucre', 'santa cruz'],
  CL: ['chile', 'chilean', 'santiago', 'valparaiso', 'atacama'],
  AR: ['argentina', 'argentine', 'argentinian', 'buenos aires', 'cordoba', 'patagonia'],
  UY: ['uruguay', 'uruguayan', 'montevideo'],
  PY: ['paraguay', 'paraguayan', 'asuncion'],
  BR: ['brazil', 'brazilian', 'brasilia', 'sao paulo', 'rio de janeiro', 'amazonas', 'salvador', 'belo horizonte'],
  GY: ['guyana', 'guyanese', 'georgetown', 'essequibo'],
  SR: ['suriname', 'surinamese', 'paramaribo'],
  FK: ['falkland islands', 'falklands', 'malvinas'],
  AQ: ['antarctica', 'antarctic'],
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build combined longest-first regex matchers for fast O(1)-pass headline scanning
const CASE_SENSITIVE_MAP = new Map();
const csPatterns = [];
for (const [term, iso2] of CASE_SENSITIVE_GAZETTEER) {
  CASE_SENSITIVE_MAP.set(term, iso2);
  csPatterns.push(escapeRegex(term));
}
csPatterns.sort((a, b) => b.length - a.length);
const CASE_SENSITIVE_REGEX = new RegExp(`(?<![A-Za-z0-9])(${csPatterns.join('|')})(?![A-Za-z0-9])`);

const CASE_INSENSITIVE_MAP = new Map();
for (const [iso2, terms] of Object.entries(GEOCODE_KEYWORDS_BY_ISO2)) {
  for (const rawTerm of terms) {
    const k = rawTerm.toLowerCase();
    if (!CASE_INSENSITIVE_MAP.has(k)) {
      CASE_INSENSITIVE_MAP.set(k, iso2);
    }
  }
}
// Also index all remaining sovereign/territory display names >= 4 chars
for (const rec of COUNTRY_FEATURES) {
  if (!rec.iso2) continue;
  const k = rec.name.toLowerCase();
  if (k.length >= 4 && !CASE_INSENSITIVE_MAP.has(k)) {
    CASE_INSENSITIVE_MAP.set(k, rec.iso2);
  }
}

const ciPatterns = [...CASE_INSENSITIVE_MAP.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegex);
const CASE_INSENSITIVE_REGEX = new RegExp(`(?<![A-Za-z0-9])(${ciPatterns.join('|')})(?![A-Za-z0-9])`, 'i');

function matchTextToCountry(text) {
  if (!text) return null;
  const cleaned = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Prefer explicit case-insensitive country/city match first; if a headline
  // has both an uppercase abbreviation ("U.S.") and a full place ("Iran"),
  // pick whichever appears earliest in the text!
  const ciMatch = CASE_INSENSITIVE_REGEX.exec(cleaned);
  const csMatch = CASE_SENSITIVE_REGEX.exec(cleaned);

  let iso2 = null;
  if (ciMatch && csMatch) {
    iso2 =
      csMatch.index < ciMatch.index
        ? CASE_SENSITIVE_MAP.get(csMatch[1])
        : CASE_INSENSITIVE_MAP.get(ciMatch[1].toLowerCase());
  } else if (ciMatch) {
    iso2 = CASE_INSENSITIVE_MAP.get(ciMatch[1].toLowerCase());
  } else if (csMatch) {
    iso2 = CASE_SENSITIVE_MAP.get(csMatch[1]);
  }

  if (!iso2) return null;
  const country = BY_ISO2.get(iso2);
  if (!country) return null;
  return { country, lat: country.lat, lon: country.lon };
}

export function geocodeHeadlineToCountry(title, description = '') {
  return matchTextToCountry(title) || matchTextToCountry(description) || null;
}

// ----------------------------------------------------------------------------
// CIA World Factbook HTML Sanitizer & Field Parsers
// ----------------------------------------------------------------------------
const NAMED_HTML_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  ndash: '-',
  mdash: '—',
  hellip: '...',
  deg: '°',
  times: '×',
  ocirc: 'ô',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  auml: 'ä',
  aring: 'å',
  iacute: 'í',
  icirc: 'î',
  oacute: 'ó',
  ouml: 'ö',
  uacute: 'ú',
  uuml: 'ü',
  ntilde: 'ñ',
  ccedil: 'ç',
  szlig: 'ß',
};

export function stripFactbookHtml(str) {
  if (str == null) return '';
  let text = String(str);

  // Preserve word separation across block/line-break tags before stripping
  text = text.replace(/<\s*br\s*\/?>/gi, ' ');
  text = text.replace(/<\/\s*(?:p|div|li|tr)\s*>/gi, ' ');
  text = text.replace(/<[^>]+>/g, '');

  // Decode numeric and named HTML entities
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const cp = parseInt(hex, 16);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
  });
  text = text.replace(/&#(\d+);/g, (_, dec) => {
    const cp = parseInt(dec, 10);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
  });
  text = text.replace(/&([a-z]+);/gi, (match, name) => {
    const decoded = NAMED_HTML_ENTITIES[name.toLowerCase()];
    return decoded !== undefined ? decoded : match;
  });

  // Normalize non-breaking spaces and whitespace
  text = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // Trim trailing "note: ..." boilerplate if preceded by main content, or leading "note:" prefix
  const noteIdx = text.search(/(?:^|[.;]\s*|\s+)note(?:\s+\d+)?\s*:/i);
  if (noteIdx > 0) {
    text = text.slice(0, noteIdx).trim();
  } else {
    text = text.replace(/^note(?:\s+\d+)?\s*:\s*/i, '').trim();
  }

  return text;
}

function getFieldInsensitive(obj, targetKey) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (targetKey in obj) return obj[targetKey];
  const wanted = targetKey.trim().toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.trim().toLowerCase() === wanted) {
      return obj[key];
    }
  }
  return undefined;
}

function getLatestYearText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  if (typeof obj.text === 'string') return stripFactbookHtml(obj.text);

  let bestYear = -1;
  let bestText = '';
  let firstText = '';

  for (const [key, val] of Object.entries(obj)) {
    if (key.trim().toLowerCase() === 'note') continue;
    if (!val || typeof val !== 'object' || typeof val.text !== 'string') continue;
    const cleaned = stripFactbookHtml(val.text);
    if (!cleaned) continue;
    if (!firstText) firstText = cleaned;

    const yearMatch = key.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const y = Number(yearMatch[0]);
      if (y > bestYear) {
        bestYear = y;
        bestText = cleaned;
      }
    }
  }
  return bestText || firstText;
}

function takeSentences(text, maxSentences = 2, maxChars = 340) {
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [text];
  let out = sentences
    .slice(0, maxSentences)
    .map((s) => s.trim())
    .join(' ')
    .trim();
  if (out.length > maxChars) {
    out = out.slice(0, maxChars - 1).replace(/\s+\S*$/, '').trim();
    if (!/[.!?]$/.test(out)) out += '…';
  }
  return out;
}

function parseConciseHazards(raw) {
  if (!raw) return '';
  // Strip verbose "volcanism: ..." appendix before cleaning if present
  const withoutVolcanism = String(raw).split(/volcanism\s*:/i)[0];
  const cleaned = stripFactbookHtml(withoutVolcanism);
  return takeSentences(cleaned, 1, 180);
}

function parseConciseSpaceAgency(raw) {
  const cleaned = stripFactbookHtml(raw);
  if (!cleaned) return '';
  // Split top-level agencies separated by semicolons outside parentheses
  let depth = 0;
  let splitIdx = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === ';' && depth === 0) {
      splitIdx = i;
      break;
    }
  }
  let primary = splitIdx > 0 ? cleaned.slice(0, splitIdx).trim() : cleaned;
  // Remove trailing year tag like "(2025)"
  primary = primary.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  if (primary.length > 130) {
    primary = primary.slice(0, 129).replace(/\s+\S*$/, '').trim() + '…';
  }
  return primary;
}

function parseMobileSubs(mobileObj) {
  if (!mobileObj || typeof mobileObj !== 'object') return '';
  const per100 = stripFactbookHtml(getFieldInsensitive(mobileObj, 'subscriptions per 100 inhabitants')?.text);
  if (per100) {
    if (/per\s*100/i.test(per100)) return per100;
    const m = per100.match(/^([0-9.,]+)(.*)$/);
    if (m) return `${m[1]} per 100${m[2]}`.trim();
    return `${per100} per 100`;
  }
  return stripFactbookHtml(getFieldInsensitive(mobileObj, 'total subscriptions')?.text);
}

function parseDisputesOrRefugees(transnational) {
  if (!transnational || typeof transnational !== 'object') return '';
  const disputes = stripFactbookHtml(getFieldInsensitive(transnational, 'Disputes - international')?.text);
  if (disputes && disputes.toLowerCase() !== 'none') {
    return takeSentences(disputes, 1, 220);
  }
  const refObj = getFieldInsensitive(transnational, 'Refugees and internally displaced persons');
  if (refObj && typeof refObj === 'object') {
    const parts = [];
    const refugees = stripFactbookHtml(getFieldInsensitive(refObj, 'refugees')?.text);
    const idps = stripFactbookHtml(getFieldInsensitive(refObj, 'IDPs')?.text);
    const stateless = stripFactbookHtml(getFieldInsensitive(refObj, 'stateless persons')?.text);
    if (refugees) parts.push(`Refugees: ${refugees}`);
    if (idps) parts.push(`IDPs: ${idps}`);
    if (stateless && parts.length < 2) parts.push(`Stateless: ${stateless}`);
    if (parts.length > 0) return parts.join('; ');
  }
  return '';
}

function parseFactbookPayload(raw) {
  const intro = getFieldInsensitive(raw, 'Introduction');
  const geo = getFieldInsensitive(raw, 'Geography');
  const people = getFieldInsensitive(raw, 'People and Society');
  const gov = getFieldInsensitive(raw, 'Government');
  const econ = getFieldInsensitive(raw, 'Economy');
  const energy = getFieldInsensitive(raw, 'Energy');
  const comms = getFieldInsensitive(raw, 'Communications');
  const mil = getFieldInsensitive(raw, 'Military and Security');
  const space = getFieldInsensitive(raw, 'Space');
  const trans = getFieldInsensitive(raw, 'Transnational Issues');

  const bgFull = stripFactbookHtml(getFieldInsensitive(intro, 'Background')?.text);
  const capitalObj = getFieldInsensitive(gov, 'Capital');
  const capitalRaw = stripFactbookHtml(getFieldInsensitive(capitalObj, 'name')?.text || capitalObj?.text);
  const capital = capitalRaw ? capitalRaw.split(';')[0].trim() : '';

  const govType = stripFactbookHtml(getFieldInsensitive(gov, 'Government type')?.text);

  const popObj = getFieldInsensitive(people, 'Population');
  const population = stripFactbookHtml(getFieldInsensitive(popObj, 'total')?.text || popObj?.text);

  const gdpPpp = getLatestYearText(getFieldInsensitive(econ, 'Real GDP (purchasing power parity)'));
  const gdpPerCapita = getLatestYearText(getFieldInsensitive(econ, 'Real GDP per capita'));

  const areaObj = getFieldInsensitive(geo, 'Area');
  const area = stripFactbookHtml(getFieldInsensitive(areaObj, 'total')?.text || areaObj?.text);

  const coastline = stripFactbookHtml(getFieldInsensitive(geo, 'Coastline')?.text);
  const hazards = parseConciseHazards(getFieldInsensitive(geo, 'Natural hazards')?.text);

  const internetObj = getFieldInsensitive(comms, 'Internet users');
  const internetPct = stripFactbookHtml(
    getFieldInsensitive(internetObj, 'percent of population')?.text || internetObj?.text
  );

  const mobileSubs = parseMobileSubs(getFieldInsensitive(comms, 'Telephones - mobile cellular'));

  const elecObj = getFieldInsensitive(energy, 'Electricity');
  const energyCap = stripFactbookHtml(getFieldInsensitive(elecObj, 'installed generating capacity')?.text);

  const militaryPct = getLatestYearText(getFieldInsensitive(mil, 'Military expenditures'));
  const spaceAgency = parseConciseSpaceAgency(getFieldInsensitive(space, 'Space agency/agencies')?.text);
  const disputes = parseDisputesOrRefugees(trans);

  return {
    background: takeSentences(bgFull, 2, 340),
    capital,
    govType,
    population,
    gdpPpp,
    gdpPerCapita,
    area,
    coastline,
    hazards,
    internetPct,
    mobileSubs,
    energyCap,
    militaryPct,
    spaceAgency,
    disputes,
  };
}

// ----------------------------------------------------------------------------
// Live World Bank Open Data v2 Multi-Indicator Enrichment
// ----------------------------------------------------------------------------
function formatCompactUsd(val) {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)} trillion`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)} billion`;
  if (val >= 1e6) return `$${Math.round(val / 1e6)} million`;
  return `$${Math.round(val).toLocaleString('en-US')}`;
}

function parseWorldBankIndicators(wbJson) {
  if (!Array.isArray(wbJson) || !Array.isArray(wbJson[1])) {
    return { overrides: {}, matchedCount: 0, wbUpdated: '' };
  }

  const wbUpdated = wbJson[0]?.lastupdated ? String(wbJson[0].lastupdated).trim() : '';
  const overrides = {};

  for (const row of wbJson[1]) {
    if (!row || row.value == null) continue;
    const val = Number(row.value);
    if (!Number.isFinite(val)) continue;

    const indicatorId = row.indicator?.id;
    const yr = row.date ? String(row.date).trim() : '';
    const yrSuffix = yr ? ` (${yr})` : '';

    switch (indicatorId) {
      case 'SP.POP.TOTL':
        if (!overrides.population) {
          overrides.population = `${Math.round(val).toLocaleString('en-US')}${yrSuffix}`;
        }
        break;
      case 'NY.GDP.MKTP.PP.CD':
        if (!overrides.gdpPpp) {
          overrides.gdpPpp = `${formatCompactUsd(val)}${yrSuffix}`;
        }
        break;
      case 'NY.GDP.PCAP.PP.CD':
        if (!overrides.gdpPerCapita) {
          overrides.gdpPerCapita = `$${Math.round(val).toLocaleString('en-US')}${yrSuffix}`;
        }
        break;
      case 'IT.NET.USER.ZS':
        if (!overrides.internetPct) {
          overrides.internetPct = `${val.toFixed(1)}%${yrSuffix}`;
        }
        break;
      case 'MS.MIL.XPND.GD.ZS':
        if (!overrides.militaryPct) {
          overrides.militaryPct = `${val.toFixed(2)}% of GDP${yrSuffix}`;
        }
        break;
      default:
        break;
    }
  }

  const matchedCount = Object.keys(overrides).length;
  return {
    overrides,
    matchedCount,
    wbUpdated: matchedCount > 0 ? wbUpdated : '',
  };
}

async function fetchWorldBankIndicators(iso3) {
  if (!iso3) return null;
  const wbPath = `/country/${encodeURIComponent(iso3)}/indicator/${WB_INDICATORS}?source=2&format=json&mrnev=1&per_page=25`;
  const primaryUrl = `${WORLDBANK_API_BASE}${wbPath}`;
  const fallbackUrl = `${WORLDBANK_PROXY_BASE}${wbPath}`;

  let wbJson;
  try {
    wbJson = await fetchJsonWithTimeout(primaryUrl, WORLDBANK_TIMEOUT_MS);
  } catch {
    try {
      wbJson = await fetchJsonWithTimeout(fallbackUrl, WORLDBANK_TIMEOUT_MS);
    } catch {
      return null;
    }
  }

  return parseWorldBankIndicators(wbJson);
}

// ----------------------------------------------------------------------------
// Live On-Demand Factbook Fetcher with Cache & Fallback Proxy
// ----------------------------------------------------------------------------
const factbookCache = new Map();
const inFlightRequests = new Map();

async function fetchJsonWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCountryFactbook(countryOrQuery) {
  const country =
    countryOrQuery && typeof countryOrQuery === 'object' && 'factbookPath' in countryOrQuery
      ? countryOrQuery
      : findCountryByCodeOrName(countryOrQuery);

  if (!country) return null;
  if (!country.factbookPath) {
    return { ...country, factbook: null };
  }

  const cacheKey = `${country.factbookPath}::${country.iso3 || ''}`;
  if (factbookCache.has(cacheKey)) {
    return { ...country, factbook: factbookCache.get(cacheKey) };
  }

  if (inFlightRequests.has(cacheKey)) {
    const parsed = await inFlightRequests.get(cacheKey);
    return { ...country, factbook: parsed };
  }

  const reqPromise = (async () => {
    const primaryUrl = `${FACTBOOK_CDN_BASE}/${country.factbookPath}`;
    const fallbackUrl = `${FACTBOOK_PROXY_BASE}/${country.factbookPath}`;

    const fetchArchive = async () => {
      try {
        return await fetchJsonWithTimeout(primaryUrl);
      } catch (primaryErr) {
        try {
          return await fetchJsonWithTimeout(fallbackUrl);
        } catch {
          throw primaryErr;
        }
      }
    };

    const [archiveRes, wbRes] = await Promise.allSettled([
      fetchArchive(),
      country.iso3 ? fetchWorldBankIndicators(country.iso3) : Promise.resolve(null),
    ]);

    if (archiveRes.status === 'rejected') {
      throw archiveRes.reason;
    }

    const parsed = parseFactbookPayload(archiveRes.value);
    const wb = wbRes.status === 'fulfilled' ? wbRes.value : null;
    if (wb && wb.matchedCount > 0) {
      for (const [k, v] of Object.entries(wb.overrides)) {
        if (v) parsed[k] = v;
      }
      parsed.hasWorldBank = true;
      parsed.wbUpdated = wb.wbUpdated;
    } else {
      parsed.hasWorldBank = false;
      parsed.wbUpdated = '';
    }

    factbookCache.set(cacheKey, parsed);
    return parsed;
  })();

  inFlightRequests.set(cacheKey, reqPromise);
  try {
    const parsed = await reqPromise;
    return { ...country, factbook: parsed };
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
