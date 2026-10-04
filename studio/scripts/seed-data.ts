// Editorial bootstrap only. Never invent accounts, media, stock, endorsements or a legal notice.
// Re-running `seed` creates missing documents; it never overwrites editor changes.
export interface SeedDocument { _id: string; _type: string; [key: string]: unknown }
const ref = (type: string, id: string) => ({ _type: "reference", _key: id, _ref: `${type}.${id}` });
const intro = (eyebrow: string, heading: string, description: string, type = "sectionIntro") => ({ _type: type, eyebrow, heading, description });
const cta = (label: string, href: string) => ({ _type: "cta", label, href });
const seo = (title: string, description: string) => ({ _type: "seo", title, description });
const names = [
  ["ollie-otter", "Ollie the Sea Otter", "Sea Otter", "The Curious Heart", "An inquisitive friend who notices others."],
  ["wally-whale-shark", "Wally the Whale Shark", "Whale Shark", "The Gentle Giant", "A calm companion for big feelings."],
  ["shelly-turtle", "Shelly the Sea Turtle", "Sea Turtle", "The Planet Guardian", "A nature-loving friend who cares for the bay."],
  ["pip-squid", "Pip the Little Squid", "Squid", "The Word Explorer", "A playful friend who keeps trying new things."],
  ["finny-clownfish", "Finny the Clownfish", "Clownfish", "The Joyful Neighbor", "A lively friend learning about friendship."],
  ["pearl-clam", "Pearl in the Shell", "Oyster", "The Quiet Wisdom", "A thoughtful friend with a quiet voice."],
] as const;
const stories = [
  ["coral", "The Lost Alphabet Coral", "A possible story about friends searching for lost letter stones and helping each other.", "Pip and Ollie"],
  ["breath", "Wally’s Big Count & Calm Breath", "A possible story about a tumble, a big feeling and trying again.", "Wally and Finny"],
  ["shore", "Shelly’s Great Shoreline Clean-Up", "A possible story about looking after a shared place.", "Shelly and Pearl"],
] as const;
const values = [
  ["bright", "Bright minds", "Ask questions and discover how things work.", ["Why?", "What if?"]],
  ["kind", "Kind hearts", "Care for others and welcome different perspectives.", ["How might they feel?"]],
  ["feelings", "Big feelings", "Name feelings and learn to navigate them.", ["What could help?"]],
  ["capable", "Capable kids", "Try things, make mistakes and try again.", ["Can I try?"]],
  ["imagine", "Wild imaginations", "Make space for creativity and wonder.", ["What could we invent?"]],
  ["planet", "Little planet protectors", "Find hopeful ways to care for nature.", ["What can we care for?"]],
] as const;
const extensions = [
  ["academy", "BIBO Academy", "Guided learning"], ["lab", "BIBO Lab", "Hands-on discovery"],
  ["play", "BIBO Play", "Imaginative play"], ["planet", "BIBO Planet", "Nature and animals"],
  ["makes", "BIBO Makes", "Craft and creativity"], ["books", "BIBO Books", "Stories and resources"],
  ["home", "BIBO at Home", "Offline family activities"], ["shop", "BIBO Shop", "Thoughtful products"],
] as const;
const questions = [
  ["what", "What is BIBO Bay?", "BIBO Bay is the developing entertainment and character world within BIBO."],
  ["episodes", "Can we watch episodes now?", "The stories shown here are concepts, not finished episodes or available videos."],
  ["signup", "What happens when I join?", "Your request to join the founding-family list is recorded when the signup service accepts it. This does not guarantee an email or download."],
] as const;
const sectionIds = ["hero", "trust", "promise", "characters", "episodes", "offline", "pillars", "ecosystem", "testimonials", "lead", "faq", "finalCta"] as const;

export function buildSeedDocuments(): SeedDocument[] {
  const collections: SeedDocument[] = [
    ...names.map(([id, name, species, role, description]) => ({ _id: `character.${id}`, _type: "character", name, species, role, description, personality: description, catchphrase: "", favoriteActivity: "", teaches: [], status: "concept" })),
    ...stories.map(([id, title, summary, characterFocus]) => ({ _id: `episodePreview.${id}`, _type: "episodePreview", title, summary, characterFocus, learningFocus: [], offlinePrompt: "Talk together about what the characters might try next.", status: "concept" })),
    ...values.map(([id, title, description, prompts]) => ({ _id: `brandPillar.${id}`, _type: "brandPillar", title, description, prompts: [...prompts] })),
    ...extensions.map(([id, name, tagline]) => ({ _id: `ecosystemEntry.${id}`, _type: "ecosystemEntry", name, tagline, description: `A possible future space for ${tagline.toLowerCase()}.`, status: "idea" })),
    ...questions.map(([id, question, answer]) => ({ _id: `faqItem.${id}`, _type: "faqItem", question, answer })),
  ];
  const siteSettings: SeedDocument = {
    _id: "siteSettings", _type: "siteSettings", title: "BIBO Bay", description: "A story world in development for curious children and their families.",
    seo: seo("BIBO Bay | Where bright little adventures begin", "Discover the ideas behind BIBO Bay, a story world in development for curious children and their families."),
    commerceEnabled: false, trackingEnabled: false, testimonialsEnabled: false, canonicalUrlVerified: false, socialLinks: [],
    navigation: { _type: "navigationSettings", links: [cta("Meet the friends", "#characters"), cta("Story ideas", "#episodes")].map((item, index) => ({ ...item, _key: `navigation-${index}` })), primaryCta: cta("Join the list", "#lead"), commerceLabel: "Shop" },
    footer: { _type: "footerSettings", text: "BIBO Bay is a developing story world within BIBO.", legalLinks: [cta("Privacy", "/privacy"), cta("Terms", "/terms")].map((item, index) => ({ ...item, _key: `legal-${index}` })), contactLabel: "Contact" },
  };
  const landingPage: SeedDocument = {
    _id: "landingPage", _type: "landingPage",
    sections: sectionIds.map((id) => ({ _type: "landingSection", _key: id, id, visible: id !== "testimonials" })),
    seo: seo("BIBO Bay | Where bright little adventures begin", "Discover the ideas behind BIBO Bay, a story world in development for curious children and their families."),
    hero: { ...intro("Welcome to BIBO Bay", "Where bright little adventures begin.", "Meet a story world in development, shaped around curiosity, kindness and imaginative play.", "heroSection"), title: "Where bright little adventures begin.", artworkDescription: "A calm, illustrated bay on the horizon.", primaryCta: cta("Meet the Bay friends", "#characters"), secondaryCta: cta("Join the founding-family list", "#lead") },
    trust: { ...intro("Our approach", "Story first, always.", "Entertain first. Enrich always.", "trustSection"), items: ["Story-first ideas", "Gentle pacing", "Screen-to-real-life inspiration", "Parent-guided exploration"] },
    promise: { ...intro("The BIBO promise", "Entertain first. Enrich always.", "Our aim is to make adventures children enjoy and parents can feel good about.", "promiseSection"), quote: "Bright minds. Kind hearts. Better humans.", body: [] },
    charactersIntro: intro("Meet the Bay friends", "Six friends, lots of ways to explore.", "These character concepts are part of the world we are developing."),
    characters: names.map(([id]) => ref("character", id)),
    episodesIntro: { ...intro("Story ideas", "Adventures we are imagining.", "These are episode concepts, not available episodes or finished media.", "episodesSectionIntro"), conceptLabel: "Story concept" },
    episodes: stories.map(([id]) => ref("episodePreview", id)),
    offline: { ...intro("Beyond the screen", "Watch. Wonder. Make. Explore.", "A story idea can spark a real-world question or family activity.", "offlineSection"), steps: [
      ["Watch", "Enjoy a story together when one is available."], ["Wonder", "Ask what the characters might discover."],
      ["Make", "Draw, build or try something together."], ["Explore", "Follow a question into the world outside."],
    ].map(([title, description], i) => ({ _key: `step-${i}`, _type: "offlineStep", title, description })) },
    pillarsIntro: intro("What matters to us", "Curiosity, kindness and more.", "The values we want to weave naturally into future stories."),
    pillars: values.map(([id]) => ref("brandPillar", id)),
    ecosystemIntro: intro("A wider world", "Ideas beyond the Bay.", "The wider BIBO ecosystem is a vision for future experiences, not a list of available products or services."),
    ecosystem: extensions.map(([id]) => ref("ecosystemEntry", id)),
    testimonialsIntro: intro("Family voices", "Experiences from families", "Verified experiences will appear here when available."), testimonials: [],
    lead: { ...intro("Founding families", "Follow the Bay as it grows.", "Adults can join the list for updates about BIBO Bay. Joining does not promise a download or an email delivery.", "leadSection"), buttonLabel: "Join the list", consentCopy: "I am an adult and agree to receive BIBO Bay updates. I can unsubscribe at any time.", successMessage: "You joined the founding-family list.", errorMessage: "We could not save your request. Please try again." },
    faqIntro: intro("Questions", "A little more about the Bay.", "What we know today about this world in development."),
    faqs: questions.map(([id]) => ref("faqItem", id)),
    finalCta: { ...intro("Stay curious", "Come explore with us.", "Follow the development of this new story world.", "finalCtaSection"), cta: cta("Join the founding-family list", "#lead") },
  };
  const legalSettings: SeedDocument = { _id: "legalSettings", _type: "legalSettings", privacy: [], terms: [], consentCopyVersion: "1" };
  return [...collections, siteSettings, landingPage, legalSettings];
}
