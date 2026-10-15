// Editorial bootstrap only. Never invent accounts, media, stock, endorsements or a legal notice.
// Re-running `seed` creates missing documents; it never overwrites editor changes.
// The copy matches the site's repository fallback (lib/content/fallback.ts) word for word; a root test
// reads this seed through the real GROQ and normalizer and requires the two to be equal.
// Source (ruling R55, 2026-10-15): the Bibo Bay YouTube channel's own About text and video descriptions.
export interface SeedDocument { _id: string; _type: string; [key: string]: unknown }
const collectionId = (type: string, id: string) => `${type}-${id}`;
const ref = (type: string, id: string) => ({ _type: "reference", _key: id, _ref: collectionId(type, id) });
const intro = (eyebrow: string, heading: string, description: string, type = "sectionIntro") => ({ _type: type, eyebrow, heading, description });
const cta = (label: string, href: string, external = false) => ({ _type: "cta", label, href, ...(external ? { external: true } : {}) });
const seo = (title: string, description: string) => ({ _type: "seo", title, description });

/** The owner-confirmed channel (2026-10-15): the one verified social account. */
const CHANNEL = "https://www.youtube.com/@bibobay-tv";
const watch = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;
const watchOnYouTube = () => cta("Watch on YouTube", CHANNEL, true);
/** The channel by id with YouTube's subscribe prompt (reliable only on /channel/<id> URLs). */
const SUBSCRIBE = "https://www.youtube.com/channel/UCFruHuRQ2eOrq9NOyx0K1GA?sub_confirmation=1";
const subscribeOnYouTube = () => cta("Subscribe on YouTube", SUBSCRIBE, true);
const SEO = ["BIBO Bay | Bright minds. Kind hearts. Big adventures.", "A gentle underwater world of mindful songs, stories and playful learning for little learners ages 2–6, with Tula, Bob and Lumi."] as const;

const names = [
  ["tula", "Tula the Turtle", "Sea turtle", "The fruit finder", "Tula loves discovering colourful fruit and counting along. When feelings feel big, she shows little ones how to breathe out a slow bubble.", ["Fruits and colours", "Counting", "Calm breathing"], "#6fbf4a"],
  ["bob", "Bob the Fish", "Clownfish", "The little spotter", "In Twinkle Twinkle Little Star Under the Sea, Bob spots tiny lights glowing in the water and calls his friends over to look.", ["Noticing", "Friendship", "Slow breaths"], "#f06b32"],
  ["lumi", "Lumi", "Octopus", "The song and dance friend", "Lumi loves to sing and dance with friends, from wiggly songs in the sunshine to gentle songs under the stars.", ["Songs and rhymes", "Moving to music", "Bedtime calm"], "#9467aa"],
] as const;
/** Real, published channel videos, each checked on 2026-10-15. */
const videos = [
  ["friends-in-the-bay", "3birY6XZ3_c", "Dance with the Sea Friends", "Dance, wiggle and move along with Tula, Lumi and Bob as they explore the colourful underwater world of Bibo Bay.", "Tula, Lumi and Bob", ["Moving to music", "Rhythm"], "Dance along together: wiggle like Bob and glide like Tula."],
  ["twinkle-under-the-sea", "1pp8G-bKeik", "Twinkle Twinkle Little Star Under the Sea", "Bob spots tiny lights in Bibo Bay and calls Lumi and Tula over to investigate: a gentle underwater adventure and a familiar song before bedtime.", "Bob, Lumi and Tula", ["Nursery rhymes", "Bedtime"], "Look for the first star tonight and sing it softly together."],
  ["bubble-breathing", "6URNMNeC_3Y", "Bubble Breathing Song", "Breathe in 1-2-3, then breathe out a bubble in the sea with Tula Turtle and Bob the Fish: a calm-down song for quiet moments.", "Tula and Bob", ["Calm breathing", "Big feelings"], "Next time feelings feel big, blow a slow pretend bubble together."],
  ["tula-fruit-adventure", "RNfHUxM-Bso", "Tula the Turtle’s Fruit Adventure", "Knock, knock! Sing along with Tula and learn the names and colours of 20 delicious fruits.", "Tula", ["Fruit names", "Colours"], "Name the colours of the fruit in your kitchen together."],
  ["count-to-ten", "CvQeoCVk_mc", "Can Your Toddler Count to 10?", "A happy, gentle counting song for learning the numbers 1 to 10, with soft music and slow-paced visuals.", "The sea friends", ["Counting 1 to 10", "Number order"], "Count ten things together on your next walk."],
  ["baby-animals", "yrpyvb5dVbA", "Baby Animals & Fun Learning", "Meet adorable baby animals with our sweet little baby, and hear the sounds they make.", "A little baby and baby animals", ["Animals", "Animal sounds"], "Make an animal sound and let your little one guess who it is."],
  ["bedtime-lullaby", "V4HEDvQD7vg", "Kids Sleep Song: A Calm Lullaby", "Original lullabies with soft music and calm vocals, to help babies and toddlers relax and drift off to sleep.", "Sleepy babies", ["Bedtime", "Calm"], "Dim the lights and hum the lullaby together at bedtime."],
] as const;
const values = [
  ["bright", "Bright minds", "Explore letters, numbers and new ideas through play.", ["Why?", "What if?"]],
  ["kind", "Kind hearts", "Learn about kindness and caring for friends.", ["How might they feel?"]],
  ["feelings", "Big feelings", "Name big feelings and find a calm, slow breath.", ["What could help?"]],
  ["capable", "Confident kids", "Build confidence by trying, and trying again.", ["Can I try?"]],
  ["imagine", "Wild imaginations", "Enjoy memorable stories, songs and adventures.", ["What could we invent?"]],
  ["planet", "Curious explorers", "Meet baby animals and the creatures of the sea.", ["What lives in the sea?"]],
] as const;
const extensions = [
  ["academy", "BIBO Academy", "Guided learning"], ["lab", "BIBO Lab", "Hands-on discovery"],
  ["play", "BIBO Play", "Imaginative play"], ["planet", "BIBO Planet", "Nature and animals"],
  ["makes", "BIBO Makes", "Craft and creativity"], ["books", "BIBO Books", "Stories and resources"],
  ["home", "BIBO at Home", "Offline family activities"], ["shop", "BIBO Shop", "Thoughtful products"],
] as const;
const questions = [
  ["what", "What is BIBO Bay?", "BIBO Bay is a gentle underwater world of mindful content for curious little learners ages 2–6: songs, stories and playful adventures with Tula, Bob and Lumi."],
  ["episodes", "Where can we watch?", "On the Bibo Bay YouTube channel, @bibobay-tv. Every video on this page opens there."],
  ["ages", "Who is it for?", "Little learners ages 2–6, and the grown-ups watching with them."],
  ["signup", "What happens when I join?", "Your request to join the founding-family list is recorded when the signup service accepts it. This does not guarantee an email or download."],
] as const;
const sectionIds = ["hero", "trust", "promise", "characters", "episodes", "offline", "pillars", "ecosystem", "testimonials", "lead", "faq", "finalCta"] as const;

export function buildSeedDocuments(): SeedDocument[] {
  const collections: SeedDocument[] = [
    ...names.map(([id, name, species, role, description, teaches, accentColor]) => ({ _id: collectionId("character", id), _type: "character", name, species, role, description, personality: description, catchphrase: "", favoriteActivity: "", teaches: [...teaches], status: "published", accentColor })),
    ...videos.map(([id, videoId, title, summary, characterFocus, learningFocus, offlinePrompt]) => ({ _id: collectionId("episodePreview", id), _type: "episodePreview", title, summary, characterFocus, learningFocus: [...learningFocus], offlinePrompt, mediaUrl: watch(videoId), status: "published" })),
    ...values.map(([id, title, description, prompts]) => ({ _id: collectionId("brandPillar", id), _type: "brandPillar", title, description, prompts: [...prompts] })),
    ...extensions.map(([id, name, tagline]) => ({ _id: collectionId("ecosystemEntry", id), _type: "ecosystemEntry", name, tagline, description: `A possible future space for ${tagline.toLowerCase()}.`, status: "idea" })),
    ...questions.map(([id, question, answer]) => ({ _id: collectionId("faqItem", id), _type: "faqItem", question, answer })),
    // The one download: the activity pack this repository ships in public/freebies (R66).
    { _id: "leadMagnet-activity-pack", _type: "leadMagnet", title: "Bibo Bay Activity Pack", description: "Eight printable pages: colour the sea friends, count with Bob, match fruit with Tula, practise bubble breathing, a bedtime chart and a watch-together page.", fileUrl: "/freebies/bibo-bay-activity-pack.pdf", available: true },
  ];
  const siteSettings: SeedDocument = {
    _id: "siteSettings", _type: "siteSettings", title: "BIBO Bay", description: "Mindful songs, stories and playful learning for little learners ages 2–6, with Tula, Bob and Lumi.",
    seo: seo(...SEO),
    commerceEnabled: false, trackingEnabled: false, testimonialsEnabled: false, canonicalUrlVerified: false, orderCountries: [],
    socialLinks: [{ _type: "socialLink", _key: "youtube", platform: "youtube", url: CHANNEL, verified: true }],
    navigation: { _type: "navigationSettings", links: [cta("Meet the friends", "#characters"), cta("Watch", "#episodes"), cta("Free activity pack", "#lead")].map((item, index) => ({ ...item, _key: `navigation-${index}` })), primaryCta: subscribeOnYouTube(), commerceLabel: "Shop" },
    footer: { _type: "footerSettings", text: "BIBO Bay: mindful content for little learners. Screen time is part of childhood. Let’s make it count.", legalLinks: [cta("Privacy", "/privacy"), cta("Terms", "/terms")].map((item, index) => ({ ...item, _key: `legal-${index}` })), contactLabel: "Contact" },
  };
  const landingPage: SeedDocument = {
    _id: "landingPage", _type: "landingPage",
    sections: sectionIds.map((id) => ({ _type: "landingSection", _key: id, id, visible: id !== "testimonials" })),
    seo: seo(...SEO),
    hero: { ...intro("Welcome to BIBO Bay", "Bright minds. Kind hearts. Big adventures.", "Mindful songs, stories and playful learning for little learners ages 2–6, with Tula, Bob and Lumi under the sea: free to watch on YouTube.", "heroSection"), title: "Bright minds. Kind hearts. Big adventures.", artworkDescription: "Tula the turtle, Bob the clownfish and Lumi the octopus on the sandy floor of a sunlit coral reef.", primaryCta: watchOnYouTube(), secondaryCta: cta("Meet Tula, Bob & Lumi", "#characters") },
    trust: { ...intro("Made with purpose", "Screen time is part of childhood. Let’s make it count.", "A calmer alternative to frantic, empty entertainment.", "trustSection"), items: ["For ages 2–6", "Calm, gentle pacing", "Playful learning, no pressure", "Lessons for everyday life"] },
    promise: { ...intro("The BIBO promise", "Content children enjoy, and parents can trust.", "Too often, children’s videos are noisy, overstimulating or made simply to keep little eyes watching. BIBO is creating something better.", "promiseSection"), quote: "Bright minds. Kind hearts. Big adventures.", body: [] },
    charactersIntro: intro("Meet the Bay friends", "Say hello to Tula, Bob and Lumi.", "Three friends who learn and grow with your little one in the gentle underwater world of Bibo Bay."),
    characters: names.map(([id]) => ref("character", id)),
    episodesIntro: { ...intro("Watch now", "Songs and adventures to watch together.", "Sing, count, breathe and wind down with the friends of Bibo Bay. Every video opens on YouTube.", "episodesSectionIntro"), conceptLabel: "Story concept", cta: subscribeOnYouTube() },
    episodes: videos.map(([id]) => ref("episodePreview", id)),
    offline: { ...intro("Beyond the screen", "Watch. Wonder. Make. Explore.", "Carry lessons from the screen into everyday life.", "offlineSection"), steps: [
      ["Watch", "Enjoy a Bibo Bay song together."], ["Wonder", "Ask what Tula, Bob or Lumi might discover next."],
      ["Make", "Draw, dance or build something together."], ["Explore", "Follow a question into the world outside."],
    ].map(([title, description], i) => ({ _key: `step-${i}`, _type: "offlineStep", title, description })) },
    pillarsIntro: intro("What little ones explore", "Bright minds. Kind hearts. Big feelings.", "Through songs, stories and playful adventures, children explore feelings, friendships and everyday moments at their own pace."),
    pillars: values.map(([id]) => ref("brandPillar", id)),
    ecosystemIntro: intro("A wider world", "Ideas beyond the Bay.", "The wider BIBO ecosystem is a vision for future experiences, not a list of available products or services."),
    ecosystem: extensions.map(([id]) => ref("ecosystemEntry", id)),
    testimonialsIntro: intro("Family voices", "Experiences from families", "Verified experiences will appear here when available."), testimonials: [],
    lead: { ...intro("Free activity pack", "Print, play and learn with the friends.", "Our free activity pack is yours to download right here, with no sign-up. Grown-ups can also join the list to hear about new adventures.", "leadSection"), buttonLabel: "Join the list", consentCopy: "I am an adult and agree to receive BIBO Bay updates. I can unsubscribe at any time.", successMessage: "You joined the founding-family list.", errorMessage: "We could not save your request. Please try again.", leadMagnet: { _type: "reference", _ref: "leadMagnet-activity-pack" } },
    faqIntro: intro("Questions", "A little more about the Bay.", "What families ask about BIBO Bay."),
    faqs: questions.map(([id]) => ref("faqItem", id)),
    finalCta: { ...intro("Come say hello", "Dive into Bibo Bay.", "New adventures are coming soon. Subscribe on YouTube to join us from the very beginning.", "finalCtaSection"), cta: subscribeOnYouTube() },
  };
  const legalSettings: SeedDocument = {
    _id: "legalSettings", _type: "legalSettings", privacy: [], terms: [], consentCopyVersion: "1",
    orderConsentCopy: "I am an adult, and I agree that BIBO Bay may use these details to answer this order request, send me a quote and deliver the order if I go ahead.",
    orderConsentCopyVersion: "order-1",
  };
  return [...collections, siteSettings, landingPage, legalSettings];
}
