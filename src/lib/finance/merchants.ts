/**
 * Merchant catalogue: normalises noisy bank-statement text ("BETALING MET
 * DEBETKAART 1234 COLRUYT GENT 08/11") into a stable merchant, assigns a
 * default category, and - for subscription services - carries the official
 * cancellation page and plain-language steps.
 *
 * Cancellation links point to the provider's own account/subscription page.
 * They can change; the UI always labels them as external links and never
 * treats opening one as proof of cancellation.
 */

export type ServiceGroup =
  | "video_streaming"
  | "music_streaming"
  | "cloud_storage"
  | "ai_assistant"
  | "news"
  | "fitness"
  | "office"
  | "gaming"
  | "audiobooks"
  | "telecom"
  | "energy"
  | "insurance"
  | "food_delivery_plus"
  | "vpn"
  | "design";

export interface SubscriptionInfo {
  group: ServiceGroup;
  cancelUrl?: string;
  steps: string[];
}

export interface MerchantEntry {
  key: string;
  name: string;
  category: string;
  patterns: RegExp[];
  subscription?: SubscriptionInfo;
}

const telecomSteps = [
  "Check your contract end date and notice period in your customer zone.",
  "Switching to another Belgian operator? Use Easy Switch: your new operator cancels the old internet/TV contract for you, so you don't pay twice.",
  "For mobile-only plans, keep your number by giving the new operator your SIM number and customer number.",
  "Wait for the written confirmation and check the final invoice for pro-rata charges.",
];

const energySteps = [
  "In Belgium, households can change electricity/gas supplier at any time with one month's notice and no exit fee.",
  "Sign up with the new supplier - they handle the switch with the grid operator.",
  "Keep your final meter reading and check the closing invoice from the old supplier.",
];

const appStoreSteps = (store: string) => [
  `Open your ${store} subscription settings (link below).`,
  "Select the subscription and choose Cancel subscription.",
  "Access usually continues until the end of the current billing period.",
  "Look for the confirmation email from the store, then mark it as confirmed here.",
];

export const MERCHANTS: MerchantEntry[] = [
  // --- Groceries ---------------------------------------------------------
  { key: "colruyt", name: "Colruyt", category: "groceries", patterns: [/colruyt/i] },
  { key: "delhaize", name: "Delhaize", category: "groceries", patterns: [/delhaize/i, /\bad\s+delhaize/i, /proxy\s*delhaize/i] },
  { key: "albert-heijn", name: "Albert Heijn", category: "groceries", patterns: [/albert\s*heijn/i, /\bah\s+(to\s*go|\d)/i] },
  { key: "aldi", name: "Aldi", category: "groceries", patterns: [/\baldi\b/i] },
  { key: "lidl", name: "Lidl", category: "groceries", patterns: [/\blidl\b/i] },
  { key: "carrefour", name: "Carrefour", category: "groceries", patterns: [/carrefour/i, /\bcrf\b/i] },
  { key: "okay", name: "OKay", category: "groceries", patterns: [/\bokay\b(?!\s*fitness)/i] },
  { key: "spar", name: "Spar", category: "groceries", patterns: [/\bspar\b/i] },
  { key: "intermarche", name: "Intermarché", category: "groceries", patterns: [/intermarch/i] },
  { key: "bio-planet", name: "Bio-Planet", category: "groceries", patterns: [/bio[\s-]?planet/i] },
  { key: "jumbo", name: "Jumbo", category: "groceries", patterns: [/\bjumbo\b/i] },
  { key: "match", name: "Match", category: "groceries", patterns: [/\bmatch\s+(super|food)/i] },
  { key: "picnic", name: "Picnic", category: "groceries", patterns: [/\bpicnic\b/i] },

  // --- Restaurants & takeaway --------------------------------------------
  { key: "deliveroo", name: "Deliveroo", category: "restaurants", patterns: [/deliveroo(?!\s*plus)/i] },
  { key: "uber-eats", name: "Uber Eats", category: "restaurants", patterns: [/uber\s*\*?\s*eats/i] },
  { key: "takeaway", name: "Takeaway.com", category: "restaurants", patterns: [/takeaway\.com|thuisbezorgd|just\s*eat/i] },
  { key: "exki", name: "EXKi", category: "restaurants", patterns: [/\bexki\b/i] },
  { key: "le-pain-quotidien", name: "Le Pain Quotidien", category: "restaurants", patterns: [/pain\s*quotidien/i] },
  { key: "mcdonalds", name: "McDonald's", category: "restaurants", patterns: [/mc\s*donald/i] },
  { key: "quick", name: "Quick", category: "restaurants", patterns: [/\bquick\s+(restaurant|\d|[a-z]+\b)/i] },
  { key: "burger-king", name: "Burger King", category: "restaurants", patterns: [/burger\s*king/i] },
  { key: "panos", name: "Panos", category: "restaurants", patterns: [/\bpanos\b/i] },
  { key: "starbucks", name: "Starbucks", category: "restaurants", patterns: [/starbucks/i] },
  { key: "dominos", name: "Domino's", category: "restaurants", patterns: [/domino'?s/i] },
  { key: "lunch-garden", name: "Lunch Garden", category: "restaurants", patterns: [/lunch\s*garden/i] },
  { key: "thefork", name: "TheFork", category: "restaurants", patterns: [/the\s*fork|lafourchette/i] },

  // --- Shopping -----------------------------------------------------------
  { key: "bol", name: "bol.com", category: "shopping", patterns: [/\bbol\.com\b|\bbol\s*com\b/i] },
  { key: "amazon", name: "Amazon", category: "shopping", patterns: [/amazon(?!\s*prime)(?!.*prime)|amzn\s*mktp|amazon\.(de|fr|nl|com|be)/i] },
  { key: "zalando", name: "Zalando", category: "shopping", patterns: [/zalando/i] },
  { key: "coolblue", name: "Coolblue", category: "shopping", patterns: [/coolblue/i] },
  { key: "mediamarkt", name: "MediaMarkt", category: "shopping", patterns: [/media\s*markt/i] },
  { key: "fnac", name: "Fnac", category: "shopping", patterns: [/\bfnac\b/i] },
  { key: "vanden-borre", name: "Vanden Borre", category: "shopping", patterns: [/vanden\s*borre/i] },
  { key: "ikea", name: "IKEA", category: "shopping", patterns: [/\bikea\b/i] },
  { key: "action", name: "Action", category: "shopping", patterns: [/\baction\s+(\d|[a-z]+\s+\d)|^action\b/i] },
  { key: "hema", name: "HEMA", category: "shopping", patterns: [/\bhema\b/i] },
  { key: "kruidvat", name: "Kruidvat", category: "shopping", patterns: [/kruidvat/i] },
  { key: "primark", name: "Primark", category: "shopping", patterns: [/primark/i] },
  { key: "hm", name: "H&M", category: "shopping", patterns: [/\bh\s*&\s*m\b|hennes/i] },
  { key: "zara", name: "Zara", category: "shopping", patterns: [/\bzara\b/i] },
  { key: "decathlon", name: "Decathlon", category: "shopping", patterns: [/decathlon/i] },
  { key: "brico", name: "Brico", category: "shopping", patterns: [/\bbrico\b|gamma\b|hubo\b/i] },
  { key: "apple-store", name: "Apple Store", category: "shopping", patterns: [/apple\s*store|apple\s+retail/i] },
  { key: "aliexpress", name: "AliExpress", category: "shopping", patterns: [/aliexpress/i] },
  { key: "temu", name: "Temu", category: "shopping", patterns: [/\btemu\b/i] },
  { key: "shein", name: "Shein", category: "shopping", patterns: [/\bshein\b/i] },

  // --- Entertainment ------------------------------------------------------
  { key: "kinepolis", name: "Kinepolis", category: "entertainment", patterns: [/kinepolis/i] },
  { key: "ugc", name: "UGC", category: "entertainment", patterns: [/\bugc\b/i] },
  { key: "ticketmaster", name: "Ticketmaster", category: "entertainment", patterns: [/ticketmaster/i] },
  { key: "steam", name: "Steam", category: "entertainment", patterns: [/\bsteam(games|powered)?\b/i] },

  // --- Transport ----------------------------------------------------------
  { key: "nmbs", name: "NMBS/SNCB", category: "transport", patterns: [/\bnmbs\b|\bsncb\b|b-?rail/i] },
  { key: "de-lijn", name: "De Lijn", category: "transport", patterns: [/de\s*lijn/i] },
  { key: "stib", name: "STIB-MIVB", category: "transport", patterns: [/\bstib\b|\bmivb\b/i] },
  { key: "tec", name: "TEC", category: "transport", patterns: [/\btec\s+(charleroi|li[eè]ge|namur|wallonie)|\bletec\b/i] },
  { key: "totalenergies-fuel", name: "TotalEnergies", category: "transport", patterns: [/total\s*energies(?!.*(power|gas|stroom|gaz))|\btotal\s+\d/i] },
  { key: "shell", name: "Shell", category: "transport", patterns: [/\bshell\b/i] },
  { key: "esso", name: "Esso", category: "transport", patterns: [/\besso\b/i] },
  { key: "q8", name: "Q8", category: "transport", patterns: [/\bq8\b/i] },
  { key: "dats24", name: "DATS 24", category: "transport", patterns: [/dats\s*24/i] },
  { key: "uber", name: "Uber", category: "transport", patterns: [/\buber\b(?!\s*\*?\s*eats)(?!\s*one)/i] },
  { key: "bolt-rides", name: "Bolt", category: "transport", patterns: [/\bbolt\.eu\b|\bbolt\s+(ride|trip)/i] },
  { key: "cambio", name: "Cambio", category: "transport", patterns: [/cambio/i] },
  { key: "poppy", name: "Poppy", category: "transport", patterns: [/\bpoppy\b/i] },
  { key: "interparking", name: "Interparking", category: "transport", patterns: [/interparking|q-?park|\b4411\b/i] },
  { key: "lime", name: "Lime", category: "transport", patterns: [/\blime\s*\*|\blime\b.*ride/i] },

  // --- Travel -------------------------------------------------------------
  { key: "ryanair", name: "Ryanair", category: "travel", patterns: [/ryanair/i] },
  { key: "brussels-airlines", name: "Brussels Airlines", category: "travel", patterns: [/brussels\s*airlines/i] },
  { key: "tui", name: "TUI", category: "travel", patterns: [/\btui\b/i] },
  { key: "booking", name: "Booking.com", category: "travel", patterns: [/booking\.com/i] },
  { key: "airbnb", name: "Airbnb", category: "travel", patterns: [/airbnb/i] },
  { key: "eurostar", name: "Eurostar", category: "travel", patterns: [/eurostar|thalys/i] },
  { key: "transavia", name: "Transavia", category: "travel", patterns: [/transavia/i] },
  { key: "klm", name: "KLM", category: "travel", patterns: [/\bklm\b/i] },
  { key: "flixbus", name: "FlixBus", category: "travel", patterns: [/flixbus/i] },
  { key: "expedia", name: "Expedia", category: "travel", patterns: [/expedia|hotels\.com/i] },

  // --- Subscriptions (with cancellation guidance) -------------------------
  {
    key: "netflix", name: "Netflix", category: "subscriptions", patterns: [/netflix/i],
    subscription: { group: "video_streaming", cancelUrl: "https://www.netflix.com/cancelplan", steps: [
      "Sign in on netflix.com and open Account.",
      "Choose Cancel membership and confirm Finish cancellation.",
      "You keep access until the end of the current billing period.",
      "Netflix emails a confirmation - mark the cancellation as confirmed once you have it.",
    ] },
  },
  {
    key: "spotify", name: "Spotify", category: "subscriptions", patterns: [/spotify/i],
    subscription: { group: "music_streaming", cancelUrl: "https://www.spotify.com/account/subscription/", steps: [
      "Log in at spotify.com/account (cancellation isn't possible in the app).",
      "Open Manage your plan, choose Cancel subscription and confirm.",
      "If you pay through Apple or Google, cancel in that store instead.",
      "Your account switches to Spotify Free at the next billing date.",
    ] },
  },
  {
    key: "disney-plus", name: "Disney+", category: "subscriptions", patterns: [/disney\s*(\+|plus)/i],
    subscription: { group: "video_streaming", cancelUrl: "https://www.disneyplus.com/account/subscription", steps: [
      "Sign in on disneyplus.com in a browser and open Account.",
      "Select your subscription and choose Cancel subscription.",
      "Confirm and wait for the confirmation email.",
    ] },
  },
  { key: "streamz", name: "Streamz", category: "subscriptions", patterns: [/streamz/i],
    subscription: { group: "video_streaming", steps: [
      "Log in on streamz.be and open My account > Subscription.",
      "If Streamz is bundled with Telenet/Proximus, cancel through that operator.",
      "Keep the confirmation email.",
    ] } },
  { key: "max", name: "Max", category: "subscriptions", patterns: [/\bhbo\s*max\b|\bmax\.com\b/i],
    subscription: { group: "video_streaming", steps: [
      "Sign in on max.com and open Settings > Subscription.",
      "Choose Cancel subscription and confirm.",
    ] } },
  {
    key: "amazon-prime", name: "Amazon Prime", category: "subscriptions", patterns: [/amazon\s*prime|prime\s*video|amzn\s*prime/i],
    subscription: { group: "video_streaming", cancelUrl: "https://www.amazon.de/gp/primecentral", steps: [
      "Open Prime membership (Prime Central) on the Amazon store you subscribed on.",
      "Choose End membership and follow the confirmation screens (there are several).",
      "Unused paid membership may be refunded - check the confirmation email.",
    ] },
  },
  {
    key: "apple", name: "Apple (App Store / iCloud+)", category: "subscriptions", patterns: [/apple\.com\/bill|itunes|icloud|apple\s*(music|tv|one)/i],
    subscription: { group: "cloud_storage", cancelUrl: "https://apps.apple.com/account/subscriptions", steps: appStoreSteps("Apple") },
  },
  {
    key: "google-one", name: "Google One", category: "subscriptions", patterns: [/google\s*(one|storage)|google\s*\*\s*google\s*one/i],
    subscription: { group: "cloud_storage", cancelUrl: "https://play.google.com/store/account/subscriptions", steps: appStoreSteps("Google Play") },
  },
  {
    key: "youtube-premium", name: "YouTube Premium", category: "subscriptions", patterns: [/youtube\s*(premium|music)|google\s*\*\s*youtube/i],
    subscription: { group: "video_streaming", cancelUrl: "https://www.youtube.com/paid_memberships", steps: [
      "Open youtube.com/paid_memberships while signed in.",
      "Choose Deactivate / Cancel membership and confirm.",
    ] },
  },
  {
    key: "deezer", name: "Deezer", category: "subscriptions", patterns: [/deezer/i],
    subscription: { group: "music_streaming", cancelUrl: "https://www.deezer.com/account/subscription", steps: [
      "Log in on deezer.com and open Account settings > Manage my subscription.",
      "Choose Cancel subscription and confirm.",
    ] },
  },
  {
    key: "audible", name: "Audible", category: "subscriptions", patterns: [/audible/i],
    subscription: { group: "audiobooks", cancelUrl: "https://help.audible.com/s/article/how-can-i-cancel-my-membership", steps: [
      "Sign in on the Audible website (not the app) and open Account details.",
      "Choose Cancel membership. Use or keep remaining credits first - they expire on cancellation.",
    ] },
  },
  {
    key: "openai", name: "ChatGPT Plus", category: "subscriptions", patterns: [/openai|chatgpt/i],
    subscription: { group: "ai_assistant", cancelUrl: "https://help.openai.com/en/articles/7232927-how-do-i-cancel-my-chatgpt-plus-subscription", steps: [
      "In ChatGPT open Settings > Account (or Subscription) > Manage.",
      "Choose Cancel plan. If you subscribed in the iOS/Android app, cancel in that store.",
    ] },
  },
  {
    key: "anthropic", name: "Claude Pro", category: "subscriptions", patterns: [/anthropic|claude\.ai/i],
    subscription: { group: "ai_assistant", cancelUrl: "https://claude.ai/settings/billing", steps: [
      "Open claude.ai > Settings > Billing.",
      "Choose Cancel plan and confirm.",
    ] },
  },
  {
    key: "microsoft-365", name: "Microsoft 365", category: "subscriptions", patterns: [/microsoft\s*(365|\*\s*365|office)|msft\s*\*/i],
    subscription: { group: "office", cancelUrl: "https://account.microsoft.com/services", steps: [
      "Sign in at account.microsoft.com/services.",
      "Find the subscription, choose Manage > Cancel subscription (or turn off recurring billing).",
    ] },
  },
  {
    key: "adobe", name: "Adobe", category: "subscriptions", patterns: [/adobe/i],
    subscription: { group: "design", cancelUrl: "https://account.adobe.com/plans", steps: [
      "Sign in at account.adobe.com/plans and choose Manage plan > Cancel your plan.",
      "Annual plans paid monthly can carry an early-termination fee - read the summary before confirming.",
    ] },
  },
  {
    key: "dropbox", name: "Dropbox", category: "subscriptions", patterns: [/dropbox/i],
    subscription: { group: "cloud_storage", cancelUrl: "https://www.dropbox.com/account/plan", steps: [
      "Sign in on dropbox.com and open Settings > Plan.",
      "Choose Cancel plan and confirm.",
    ] },
  },
  { key: "notion", name: "Notion", category: "subscriptions", patterns: [/notion\s*labs|notion\.so/i],
    subscription: { group: "office", steps: ["Open Settings > Plans in Notion and downgrade to Free.", "Check that no other workspace still carries a paid plan."] } },
  {
    key: "canva", name: "Canva", category: "subscriptions", patterns: [/canva/i],
    subscription: { group: "design", cancelUrl: "https://www.canva.com/settings/billing-and-plans", steps: [
      "Open Settings > Billing & plans on canva.com and choose Cancel subscription.",
    ] },
  },
  {
    key: "github", name: "GitHub", category: "business", patterns: [/github/i],
    subscription: { group: "office", cancelUrl: "https://github.com/settings/billing", steps: [
      "Open github.com/settings/billing and downgrade the plan or remove paid add-ons (Copilot, LFS).",
    ] },
  },
  { key: "duolingo", name: "Duolingo", category: "subscriptions", patterns: [/duolingo/i],
    subscription: { group: "office", steps: ["Cancel in the app store you subscribed through (Apple/Google) or in duolingo.com settings."] } },
  { key: "strava", name: "Strava", category: "subscriptions", patterns: [/strava/i],
    subscription: { group: "fitness", steps: ["On strava.com open Settings > My Account > Downgrade.", "If billed by Apple/Google, cancel in that store."] } },
  { key: "linkedin", name: "LinkedIn Premium", category: "subscriptions", patterns: [/linkedin/i],
    subscription: { group: "office", steps: ["Open Me > Premium features > Manage Premium account > Cancel subscription."] } },
  { key: "nytimes", name: "The New York Times", category: "subscriptions", patterns: [/ny\s*times|nytimes/i],
    subscription: { group: "news", steps: ["Open Account > Subscription overview > Cancel subscription on nytimes.com."] } },
  { key: "de-standaard", name: "De Standaard", category: "subscriptions", patterns: [/de\s*standaard|mediahuis/i],
    subscription: { group: "news", steps: ["Contact Mediahuis customer service or use the online form in your subscription settings.", "Ask for written confirmation of the end date."] } },
  { key: "le-soir", name: "Le Soir", category: "subscriptions", patterns: [/le\s*soir|rossel/i],
    subscription: { group: "news", steps: ["Use the Le Soir subscriber area or contact customer service to stop the subscription.", "Ask for written confirmation of the end date."] } },
  { key: "playstation-plus", name: "PlayStation Plus", category: "subscriptions", patterns: [/playstation|sony\s*interactive|psn/i],
    subscription: { group: "gaming", steps: ["Open Account Management > Subscription on playstation.com and turn off auto-renew."] } },
  { key: "xbox", name: "Xbox Game Pass", category: "subscriptions", patterns: [/xbox/i],
    subscription: { group: "gaming", cancelUrl: "https://account.microsoft.com/services", steps: ["Open account.microsoft.com/services and turn off recurring billing for Game Pass."] } },
  { key: "nordvpn", name: "NordVPN", category: "subscriptions", patterns: [/nordvpn|nord\s*sec/i],
    subscription: { group: "vpn", steps: ["Open Nord Account > Billing > Subscriptions and cancel auto-renewal."] } },
  { key: "proton", name: "Proton", category: "subscriptions", patterns: [/proton\s*(ag|mail|vpn)/i],
    subscription: { group: "vpn", steps: ["Open Settings > Dashboard in Proton and cancel the subscription."] } },
  { key: "uber-one", name: "Uber One", category: "subscriptions", patterns: [/uber\s*one/i],
    subscription: { group: "food_delivery_plus", steps: ["In the Uber app open Account > Uber One > Manage membership > End membership."] } },
  { key: "deliveroo-plus", name: "Deliveroo Plus", category: "subscriptions", patterns: [/deliveroo\s*plus/i],
    subscription: { group: "food_delivery_plus", steps: ["In the Deliveroo app open Account > Deliveroo Plus > Cancel."] } },

  // --- Health & fitness ---------------------------------------------------
  {
    key: "basic-fit", name: "Basic-Fit", category: "health", patterns: [/basic[\s-]?fit/i],
    subscription: { group: "fitness", cancelUrl: "https://my.basic-fit.com/", steps: [
      "Log in to My Basic-Fit (website or app) and open Membership.",
      "Choose Cancel membership - check the notice period and end date shown.",
      "Basic-Fit sends a written confirmation; keep it and mark the cancellation as confirmed here.",
    ] },
  },
  { key: "jims", name: "Jims", category: "health", patterns: [/\bjims\b/i],
    subscription: { group: "fitness", steps: ["Cancel via your Jims member area or at the front desk; ask for written confirmation."] } },
  { key: "pharmacy", name: "Pharmacy", category: "health", patterns: [/apotheek|pharmacie|multipharma|medi-?market|pharmacy/i] },
  { key: "dentist", name: "Dentist", category: "health", patterns: [/tandarts|dentist/i] },
  { key: "doctor", name: "Doctor", category: "health", patterns: [/huisarts|\bdokter\b|m[ée]decin|\bdr\.?\s/i] },
  { key: "hospital", name: "Hospital", category: "health", patterns: [/\b(uz|az|chu|chr)\s+[a-z]/i, /ziekenhuis|h[ôo]pital|hospital/i] },
  { key: "mutualite", name: "Health insurance fund", category: "health", patterns: [/mutualit|mutualiteit|ziekenfonds|\bhelan\b|solidaris|partenamut|christelijke\s*mut|\bcm\b\s|\bmc\b\s|liberale\s*mut|neutrale\s*mut/i] },

  // --- Bills & utilities (recurring, with switching guidance) -------------
  { key: "proximus", name: "Proximus", category: "bills", patterns: [/proximus/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "telenet", name: "Telenet", category: "bills", patterns: [/telenet/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "orange", name: "Orange Belgium", category: "bills", patterns: [/orange\s*(belgium|be\b)|\borange\s+sa/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "base", name: "BASE", category: "bills", patterns: [/\bbase\s+(company|mobile)|base\.be/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "voo", name: "VOO", category: "bills", patterns: [/\bvoo\b/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "scarlet", name: "Scarlet", category: "bills", patterns: [/scarlet/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "mobile-vikings", name: "Mobile Vikings", category: "bills", patterns: [/mobile\s*vikings/i], subscription: { group: "telecom", steps: telecomSteps } },
  { key: "engie", name: "Engie", category: "bills", patterns: [/engie|electrabel/i], subscription: { group: "energy", steps: energySteps } },
  { key: "luminus", name: "Luminus", category: "bills", patterns: [/luminus/i], subscription: { group: "energy", steps: energySteps } },
  { key: "totalenergies-power", name: "TotalEnergies Power & Gas", category: "bills", patterns: [/total\s*energies.*(power|gas|stroom|gaz)|lampiris/i], subscription: { group: "energy", steps: energySteps } },
  { key: "eneco", name: "Eneco", category: "bills", patterns: [/eneco/i], subscription: { group: "energy", steps: energySteps } },
  { key: "mega", name: "Mega", category: "bills", patterns: [/\bmega\s+(energ|sa)/i], subscription: { group: "energy", steps: energySteps } },
  { key: "fluvius", name: "Fluvius", category: "bills", patterns: [/fluvius/i] },
  { key: "water", name: "Water utility", category: "bills", patterns: [/de\s*watergroep|water-link|vivaqua|\bswde\b|farys|pidpa/i] },
  { key: "insurance", name: "Insurance", category: "bills", patterns: [/ag\s*insurance|\bethias\b|\baxa\b|baloise|\bp\s*&\s*v\b|kbc\s*verzeker|belfius\s*(insurance|verzeker)|\bdkv\b|allianz|vivium|\bdvv\b/i], subscription: { group: "insurance", steps: [
    "Belgian insurance contracts usually renew yearly; send a cancellation at least 3 months before the renewal date.",
    "Send it by registered letter, bailiff's writ or against a receipt (or via your broker).",
    "Keep proof of sending and the insurer's confirmation.",
  ] } },
  { key: "fod-financien", name: "FOD Financiën / SPF Finances", category: "bills", patterns: [/fod\s*financi|spf\s*finances|myminfin/i] },

  // --- Business -----------------------------------------------------------
  { key: "aws", name: "Amazon Web Services", category: "business", patterns: [/\baws\b|amazon\s*web\s*services/i] },
  { key: "google-cloud", name: "Google Cloud", category: "business", patterns: [/google\s*cloud|google\s*\*\s*gsuite|google\s*workspace/i] },
  { key: "vercel", name: "Vercel", category: "business", patterns: [/vercel/i] },
  { key: "hetzner", name: "Hetzner", category: "business", patterns: [/hetzner/i] },
  { key: "ovh", name: "OVHcloud", category: "business", patterns: [/\bovh/i] },
  { key: "combell", name: "Combell", category: "business", patterns: [/combell/i] },
  { key: "accountable", name: "Accountable", category: "business", patterns: [/accountable/i] },
];

const BY_KEY = new Map(MERCHANTS.map((m) => [m.key, m]));

export function merchantByKey(key: string | null | undefined): MerchantEntry | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function matchMerchant(text: string | null | undefined): MerchantEntry | undefined {
  if (!text) return undefined;
  for (const m of MERCHANTS) {
    if (m.patterns.some((p) => p.test(text))) return m;
  }
  return undefined;
}

// Noise frequently found in Belgian / EU bank statement lines.
const NOISE = [
  /betaling\s+met\s+(debetkaart|bancontact|kredietkaart|visa|maestro)/gi,
  /aankoop\s+(bancontact|maestro|visa)/gi,
  /paiement\s+(par\s+carte|bancontact|maestro|visa|carte\s+de\s+d[ée]bit)/gi,
  /(card|contactless)\s+payment(\s+to)?/gi,
  /\b(bancontact|maestro|visa|mastercard|debit|debetkaart|kaart|carte|apple\s*pay|google\s*pay|contactless|sepa|europese\s+domici\w*|domiciliation\s+europ\w*|direct\s+debit)\b/gi,
  /\b(nv|sa|bv|srl|bvba|sprl|ltd|gmbh|inc|llc|vof|cv)\b\.?/gi,
  /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, // dates
  /\b\d{1,2}[:h]\d{2}\b/g, // times
  /\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b/gi, // IBAN-like
  /\bx{2,}\d+\b/gi, // masked card numbers
  /\*+\d*/g,
  /\b\d{3,}\b/g, // long numbers / terminal ids
  /\bref(erence|erentie)?\s*[:.]?\s*\S+/gi,
  /[#:;]/g,
];

const CITY_WORDS = /\b(brussel|bruxelles|brussels|antwerpen|anvers|gent|gand|leuven|louvain|liege|li[eè]ge|namur|namen|mechelen|brugge|bruges|hasselt|charleroi|mons|kortrijk|aalst|oostende|ostende|ixelles|elsene|etterbeek|schaerbeek|uccle|ukkel|be|bel|belgium|belgique|belgie|belgië)\b/gi;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 2 && w !== "de" ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Best-effort clean display name for an unknown merchant. */
export function cleanMerchantName(raw: string): string {
  let s = ` ${raw} `;
  for (const n of NOISE) s = s.replace(n, " ");
  s = s.replace(CITY_WORDS, " ").replace(/[^\p{L}\p{N}&'.+\- ]/gu, " ").replace(/\s+/g, " ").trim();
  const words = s.split(" ").filter((w) => w.length > 1 || /\d/.test(w));
  const name = words.slice(0, 3).join(" ");
  return name ? titleCase(name) : titleCase(raw.trim().slice(0, 40));
}

export interface NormalisedMerchant {
  name: string;
  key: string;
  entry?: MerchantEntry;
}

export function normaliseMerchant(...candidates: (string | null | undefined)[]): NormalisedMerchant {
  for (const c of candidates) {
    const entry = matchMerchant(c);
    if (entry) return { name: entry.name, key: entry.key, entry };
  }
  const first = candidates.find((c) => c && c.trim().length > 0) ?? "Unknown";
  const name = cleanMerchantName(first);
  return { name, key: slugify(name) || "unknown" };
}

export const SERVICE_GROUP_LABEL: Record<ServiceGroup, string> = {
  video_streaming: "video streaming",
  music_streaming: "music streaming",
  cloud_storage: "cloud storage",
  ai_assistant: "AI assistants",
  news: "news",
  fitness: "fitness",
  office: "productivity",
  gaming: "gaming",
  audiobooks: "audiobooks",
  telecom: "telecom",
  energy: "energy",
  insurance: "insurance",
  food_delivery_plus: "delivery memberships",
  vpn: "VPN / privacy",
  design: "design tools",
};
