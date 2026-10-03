import type { Character, EpisodePreview, LandingPageContent, LegalSettings, SiteSettings, SectionId } from "./types";

const character = (id: string, name: string, species: string, role: string, description: string): Character => ({
  id, name, species, role, description, personality: description, catchphrase: "", favoriteActivity: "", teaches: [], status: "concept",
});
const episode = (id: string, title: string, summary: string, characterFocus: string): EpisodePreview => ({
  id, title, summary, characterFocus, learningFocus: [], offlinePrompt: "Talk together about what the characters might try next.", status: "concept",
});
const sectionIds: SectionId[] = ["hero", "trust", "promise", "characters", "episodes", "offline", "pillars", "ecosystem", "testimonials", "lead", "faq", "finalCta"];
export const DEFAULT_SECTION_IDS = sectionIds;

export const SAFE_FALLBACK_CONTENT: LandingPageContent = {
  sections: sectionIds.map((id) => ({ id, visible: id !== "testimonials" })),
  seo: { title: "BIBO Bay | Where bright little adventures begin", description: "Discover the ideas behind BIBO Bay, a story world in development for curious children and their families." },
  hero: { eyebrow: "Welcome to BIBO Bay", heading: "Where bright little adventures begin.", title: "Where bright little adventures begin.", description: "Meet a story world in development, shaped around curiosity, kindness and imaginative play.", artworkDescription: "A calm, illustrated bay on the horizon.", primaryCta: { label: "Meet the Bay friends", href: "#characters" }, secondaryCta: { label: "Join the founding-family list", href: "#lead" } },
  trust: { eyebrow: "Our approach", heading: "Story first, always.", description: "Entertain first. Enrich always.", items: ["Story-first ideas", "Gentle pacing", "Screen-to-real-life inspiration", "Parent-guided exploration"] },
  promise: { eyebrow: "The BIBO promise", heading: "Entertain first. Enrich always.", description: "Our aim is to make adventures children enjoy and parents can feel good about.", quote: "Bright minds. Kind hearts. Better humans.", body: [] },
  charactersIntro: { eyebrow: "Meet the Bay friends", heading: "Six friends, lots of ways to explore.", description: "These character concepts are part of the world we are developing." },
  characters: [
    character("ollie-otter", "Ollie the Sea Otter", "Sea Otter", "The Curious Heart", "An inquisitive friend who notices others."),
    character("wally-whale-shark", "Wally the Whale Shark", "Whale Shark", "The Gentle Giant", "A calm companion for big feelings."),
    character("shelly-turtle", "Shelly the Sea Turtle", "Sea Turtle", "The Planet Guardian", "A nature-loving friend who cares for the bay."),
    character("pip-squid", "Pip the Little Squid", "Squid", "The Word Explorer", "A playful friend who keeps trying new things."),
    character("finny-clownfish", "Finny the Clownfish", "Clownfish", "The Joyful Neighbor", "A lively friend learning about friendship."),
    character("pearl-clam", "Pearl in the Shell", "Oyster", "The Quiet Wisdom", "A thoughtful friend with a quiet voice."),
  ],
  episodesIntro: { eyebrow: "Story ideas", heading: "Adventures we are imagining.", description: "These are episode concepts, not available episodes or finished media.", conceptLabel: "Story concept" },
  episodes: [
    episode("coral", "The Lost Alphabet Coral", "A possible story about friends searching for lost letter stones and helping each other.", "Pip and Ollie"),
    episode("breath", "Wally’s Big Count & Calm Breath", "A possible story about a tumble, a big feeling and trying again.", "Wally and Finny"),
    episode("shore", "Shelly’s Great Shoreline Clean-Up", "A possible story about looking after a shared place.", "Shelly and Pearl"),
  ],
  offline: { eyebrow: "Beyond the screen", heading: "Watch. Wonder. Make. Explore.", description: "A story idea can spark a real-world question or family activity.", steps: [{ title: "Watch", description: "Enjoy a story together when one is available." }, { title: "Wonder", description: "Ask what the characters might discover." }, { title: "Make", description: "Draw, build or try something together." }, { title: "Explore", description: "Follow a question into the world outside." }] },
  pillarsIntro: { eyebrow: "What matters to us", heading: "Curiosity, kindness and more.", description: "The values we want to weave naturally into future stories." },
  pillars: [
    { id: "bright", title: "Bright minds", description: "Ask questions and discover how things work.", prompts: ["Why?", "What if?"] },
    { id: "kind", title: "Kind hearts", description: "Care for others and welcome different perspectives.", prompts: ["How might they feel?"] },
    { id: "feelings", title: "Big feelings", description: "Name feelings and learn to navigate them.", prompts: ["What could help?"] },
    { id: "capable", title: "Capable kids", description: "Try things, make mistakes and try again.", prompts: ["Can I try?"] },
    { id: "imagine", title: "Wild imaginations", description: "Make space for creativity and wonder.", prompts: ["What could we invent?"] },
    { id: "planet", title: "Little planet protectors", description: "Find hopeful ways to care for nature.", prompts: ["What can we care for?"] },
  ],
  ecosystemIntro: { eyebrow: "A wider world", heading: "Ideas beyond the Bay.", description: "The wider BIBO ecosystem is a vision for future experiences, not a list of available products or services." },
  ecosystem: [
    ["academy", "BIBO Academy", "Guided learning"], ["lab", "BIBO Lab", "Hands-on discovery"], ["play", "BIBO Play", "Imaginative play"], ["planet", "BIBO Planet", "Nature and animals"], ["makes", "BIBO Makes", "Craft and creativity"], ["books", "BIBO Books", "Stories and resources"], ["home", "BIBO at Home", "Offline family activities"], ["shop", "BIBO Shop", "Thoughtful products"],
  ].map(([id, name, tagline]) => ({ id: id!, name: name!, tagline: tagline!, description: `A possible future space for ${tagline!.toLowerCase()}.`, status: "idea" as const })),
  testimonialsIntro: { eyebrow: "Family voices", heading: "Experiences from families", description: "Verified experiences will appear here when available." },
  testimonials: [],
  lead: { eyebrow: "Founding families", heading: "Follow the Bay as it grows.", description: "Adults can join the list for updates about BIBO Bay. Joining does not promise a download or an email delivery.", buttonLabel: "Join the list", consentCopy: "I am an adult and agree to receive BIBO Bay updates. I can unsubscribe at any time.", successMessage: "You joined the founding-family list.", errorMessage: "We could not save your request. Please try again." },
  faqIntro: { eyebrow: "Questions", heading: "A little more about the Bay.", description: "What we know today about this world in development." },
  faqs: [
    { id: "what", question: "What is BIBO Bay?", answer: "BIBO Bay is the developing entertainment and character world within BIBO." },
    { id: "episodes", question: "Can we watch episodes now?", answer: "The stories shown here are concepts, not finished episodes or available videos." },
    { id: "signup", question: "What happens when I join?", answer: "Your request to join the founding-family list is recorded when the signup service accepts it. This does not guarantee an email or download." },
  ],
  finalCta: { eyebrow: "Stay curious", heading: "Come explore with us.", description: "Follow the development of this new story world.", cta: { label: "Join the founding-family list", href: "#lead" } },
};

export const SAFE_FALLBACK_SETTINGS: SiteSettings = {
  title: "BIBO Bay", description: "A story world in development for curious children and their families.", seo: SAFE_FALLBACK_CONTENT.seo,
  commerceEnabled: false, trackingEnabled: false, testimonialsEnabled: false, socialLinks: [],
  navigation: { links: [{ label: "Meet the friends", href: "#characters" }, { label: "Story ideas", href: "#episodes" }], primaryCta: { label: "Join the list", href: "#lead" }, commerceLabel: "Shop" },
  footer: { text: "BIBO Bay is a developing story world within BIBO.", legalLinks: [{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }], contactLabel: "Contact" },
};
export const SAFE_FALLBACK_LEGAL: LegalSettings = { privacy: [], terms: [], consentCopyVersion: "1" };
