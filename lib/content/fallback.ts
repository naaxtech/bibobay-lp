import type { Character, EpisodePreview, LandingPageContent, LegalSettings, SiteSettings, SectionId } from "./types";

/*
 * Safe repository content, used whenever Sanity is unconfigured or unreachable; the Studio seed
 * (studio/scripts/seed-data.ts) holds the same copy.
 *
 * Source of truth (ruling R55, 2026-10-15): the Bibo Bay YouTube channel. Every claim below comes from
 * the channel's own About text and video descriptions: the cast (Tula the turtle, Bob the fish, Lumi
 * the octopus), the ages (2–6) and the real published videos, each linked to its youtube.com watch
 * page. No counts, ratings or endorsements are stated.
 */

/** The channel this site belongs to; the only social link, confirmed by the owner on 2026-10-15. */
export const BIBO_YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@bibobay-tv";

/**
 * The same channel by its id (the canonical /channel/ URL behind @bibobay-tv, read 2026-10-15) with
 * YouTube's subscribe prompt. The prompt is only reliable on /channel/<id> URLs, not on @handles.
 * The owner's directive (2026-10-15): YouTube is where Bibo Bay is watched, so the page's calls to
 * action lead there.
 */
export const BIBO_YOUTUBE_SUBSCRIBE_URL = "https://www.youtube.com/channel/UCFruHuRQ2eOrq9NOyx0K1GA?sub_confirmation=1";

/** The real, published Bibo Bay videos the fallback links to (each checked on the channel, 2026-10-15). */
export const BIBO_VIDEO_IDS = {
  friendsInTheBay: "3birY6XZ3_c",
  twinkleUnderTheSea: "1pp8G-bKeik",
  bubbleBreathing: "6URNMNeC_3Y",
  tulaFruitAdventure: "RNfHUxM-Bso",
  countToTen: "CvQeoCVk_mc",
  babyAnimals: "yrpyvb5dVbA",
  bedtimeLullaby: "V4HEDvQD7vg",
} as const;

export const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

const character = (id: string, name: string, species: string, role: string, description: string, teaches: string[], accentColor: string): Character => ({
  id, name, species, role, description, personality: description, catchphrase: "", favoriteActivity: "", teaches, status: "published", accentColor,
});
const video = (id: string, videoId: string, title: string, summary: string, characterFocus: string, learningFocus: string[], offlinePrompt: string): EpisodePreview => ({
  id, title, summary, characterFocus, learningFocus, offlinePrompt, mediaUrl: youtubeWatchUrl(videoId), status: "published",
});
const sectionIds: SectionId[] = ["hero", "trust", "promise", "characters", "episodes", "offline", "pillars", "ecosystem", "testimonials", "lead", "faq", "finalCta"];
export const DEFAULT_SECTION_IDS = sectionIds;

const watchOnYouTube = { label: "Watch on YouTube", href: BIBO_YOUTUBE_CHANNEL_URL, external: true };
const subscribeOnYouTube = { label: "Subscribe on YouTube", href: BIBO_YOUTUBE_SUBSCRIBE_URL, external: true };

export const SAFE_FALLBACK_CONTENT: LandingPageContent = {
  sections: sectionIds.map((id) => ({ id, visible: id !== "testimonials" })),
  seo: { title: "BIBO Bay | Bright minds. Kind hearts. Big adventures.", description: "A gentle underwater world of mindful songs, stories and playful learning for little learners ages 2–6, with Tula, Bob and Lumi." },
  hero: {
    eyebrow: "Welcome to BIBO Bay",
    heading: "Bright minds. Kind hearts. Big adventures.",
    title: "Bright minds. Kind hearts. Big adventures.",
    description: "Mindful songs, stories and playful learning for little learners ages 2–6, with Tula, Bob and Lumi under the sea: free to watch on YouTube.",
    artworkDescription: "Tula the turtle, Bob the clownfish and Lumi the octopus on the sandy floor of a sunlit coral reef.",
    primaryCta: watchOnYouTube,
    secondaryCta: { label: "Meet Tula, Bob & Lumi", href: "#characters" },
  },
  trust: { eyebrow: "Made with purpose", heading: "Screen time is part of childhood. Let’s make it count.", description: "A calmer alternative to frantic, empty entertainment.", items: ["For ages 2–6", "Calm, gentle pacing", "Playful learning, no pressure", "Lessons for everyday life"] },
  promise: { eyebrow: "The BIBO promise", heading: "Content children enjoy, and parents can trust.", description: "Too often, children’s videos are noisy, overstimulating or made simply to keep little eyes watching. BIBO is creating something better.", quote: "Bright minds. Kind hearts. Big adventures.", body: [] },
  charactersIntro: { eyebrow: "Meet the Bay friends", heading: "Say hello to Tula, Bob and Lumi.", description: "Three friends who learn and grow with your little one in the gentle underwater world of Bibo Bay." },
  characters: [
    character("tula", "Tula the Turtle", "Sea turtle", "The fruit finder", "Tula loves discovering colourful fruit and counting along. When feelings feel big, she shows little ones how to breathe out a slow bubble.", ["Fruits and colours", "Counting", "Calm breathing"], "#6fbf4a"),
    character("bob", "Bob the Fish", "Clownfish", "The little spotter", "In Twinkle Twinkle Little Star Under the Sea, Bob spots tiny lights glowing in the water and calls his friends over to look.", ["Noticing", "Friendship", "Slow breaths"], "#f06b32"),
    character("lumi", "Lumi", "Octopus", "The song and dance friend", "Lumi loves to sing and dance with friends, from wiggly songs in the sunshine to gentle songs under the stars.", ["Songs and rhymes", "Moving to music", "Bedtime calm"], "#9467aa"),
  ],
  episodesIntro: { eyebrow: "Watch now", heading: "Songs and adventures to watch together.", description: "Sing, count, breathe and wind down with the friends of Bibo Bay. Every video opens on YouTube.", conceptLabel: "Story concept", cta: subscribeOnYouTube },
  episodes: [
    video("friends-in-the-bay", BIBO_VIDEO_IDS.friendsInTheBay, "Dance with the Sea Friends", "Dance, wiggle and move along with Tula, Lumi and Bob as they explore the colourful underwater world of Bibo Bay.", "Tula, Lumi and Bob", ["Moving to music", "Rhythm"], "Dance along together: wiggle like Bob and glide like Tula."),
    video("twinkle-under-the-sea", BIBO_VIDEO_IDS.twinkleUnderTheSea, "Twinkle Twinkle Little Star Under the Sea", "Bob spots tiny lights in Bibo Bay and calls Lumi and Tula over to investigate: a gentle underwater adventure and a familiar song before bedtime.", "Bob, Lumi and Tula", ["Nursery rhymes", "Bedtime"], "Look for the first star tonight and sing it softly together."),
    video("bubble-breathing", BIBO_VIDEO_IDS.bubbleBreathing, "Bubble Breathing Song", "Breathe in 1-2-3, then breathe out a bubble in the sea with Tula Turtle and Bob the Fish: a calm-down song for quiet moments.", "Tula and Bob", ["Calm breathing", "Big feelings"], "Next time feelings feel big, blow a slow pretend bubble together."),
    video("tula-fruit-adventure", BIBO_VIDEO_IDS.tulaFruitAdventure, "Tula the Turtle’s Fruit Adventure", "Knock, knock! Sing along with Tula and learn the names and colours of 20 delicious fruits.", "Tula", ["Fruit names", "Colours"], "Name the colours of the fruit in your kitchen together."),
    video("count-to-ten", BIBO_VIDEO_IDS.countToTen, "Can Your Toddler Count to 10?", "A happy, gentle counting song for learning the numbers 1 to 10, with soft music and slow-paced visuals.", "The sea friends", ["Counting 1 to 10", "Number order"], "Count ten things together on your next walk."),
    video("baby-animals", BIBO_VIDEO_IDS.babyAnimals, "Baby Animals & Fun Learning", "Meet adorable baby animals with our sweet little baby, and hear the sounds they make.", "A little baby and baby animals", ["Animals", "Animal sounds"], "Make an animal sound and let your little one guess who it is."),
    video("bedtime-lullaby", BIBO_VIDEO_IDS.bedtimeLullaby, "Kids Sleep Song: A Calm Lullaby", "Original lullabies with soft music and calm vocals, to help babies and toddlers relax and drift off to sleep.", "Sleepy babies", ["Bedtime", "Calm"], "Dim the lights and hum the lullaby together at bedtime."),
  ],
  offline: { eyebrow: "Beyond the screen", heading: "Watch. Wonder. Make. Explore.", description: "Carry lessons from the screen into everyday life.", steps: [{ title: "Watch", description: "Enjoy a Bibo Bay song together." }, { title: "Wonder", description: "Ask what Tula, Bob or Lumi might discover next." }, { title: "Make", description: "Draw, dance or build something together." }, { title: "Explore", description: "Follow a question into the world outside." }] },
  pillarsIntro: { eyebrow: "What little ones explore", heading: "Bright minds. Kind hearts. Big feelings.", description: "Through songs, stories and playful adventures, children explore feelings, friendships and everyday moments at their own pace." },
  pillars: [
    { id: "bright", title: "Bright minds", description: "Explore letters, numbers and new ideas through play.", prompts: ["Why?", "What if?"] },
    { id: "kind", title: "Kind hearts", description: "Learn about kindness and caring for friends.", prompts: ["How might they feel?"] },
    { id: "feelings", title: "Big feelings", description: "Name big feelings and find a calm, slow breath.", prompts: ["What could help?"] },
    { id: "capable", title: "Confident kids", description: "Build confidence by trying, and trying again.", prompts: ["Can I try?"] },
    { id: "imagine", title: "Wild imaginations", description: "Enjoy memorable stories, songs and adventures.", prompts: ["What could we invent?"] },
    { id: "planet", title: "Curious explorers", description: "Meet baby animals and the creatures of the sea.", prompts: ["What lives in the sea?"] },
  ],
  ecosystemIntro: { eyebrow: "A wider world", heading: "Ideas beyond the Bay.", description: "The wider BIBO ecosystem is a vision for future experiences, not a list of available products or services." },
  ecosystem: [
    ["academy", "BIBO Academy", "Guided learning"], ["lab", "BIBO Lab", "Hands-on discovery"], ["play", "BIBO Play", "Imaginative play"], ["planet", "BIBO Planet", "Nature and animals"], ["makes", "BIBO Makes", "Craft and creativity"], ["books", "BIBO Books", "Stories and resources"], ["home", "BIBO at Home", "Offline family activities"], ["shop", "BIBO Shop", "Thoughtful products"],
  ].map(([id, name, tagline]) => ({ id: id!, name: name!, tagline: tagline!, description: `A possible future space for ${tagline!.toLowerCase()}.`, status: "idea" as const })),
  testimonialsIntro: { eyebrow: "Family voices", heading: "Experiences from families", description: "Verified experiences will appear here when available." },
  testimonials: [],
  lead: { eyebrow: "Founding families", heading: "Be first to hear about new adventures.", description: "Adults can join the list for updates about BIBO Bay. Joining does not promise a download or an email delivery.", buttonLabel: "Join the list", consentCopy: "I am an adult and agree to receive BIBO Bay updates. I can unsubscribe at any time.", successMessage: "You joined the founding-family list.", errorMessage: "We could not save your request. Please try again." },
  faqIntro: { eyebrow: "Questions", heading: "A little more about the Bay.", description: "What families ask about BIBO Bay." },
  faqs: [
    { id: "what", question: "What is BIBO Bay?", answer: "BIBO Bay is a gentle underwater world of mindful content for curious little learners ages 2–6: songs, stories and playful adventures with Tula, Bob and Lumi." },
    { id: "episodes", question: "Where can we watch?", answer: "On the Bibo Bay YouTube channel, @bibobay-tv. Every video on this page opens there." },
    { id: "ages", question: "Who is it for?", answer: "Little learners ages 2–6, and the grown-ups watching with them." },
    { id: "signup", question: "What happens when I join?", answer: "Your request to join the founding-family list is recorded when the signup service accepts it. This does not guarantee an email or download." },
  ],
  finalCta: { eyebrow: "Come say hello", heading: "Dive into Bibo Bay.", description: "New adventures are coming soon. Subscribe on YouTube to join us from the very beginning.", cta: subscribeOnYouTube },
};

export const SAFE_FALLBACK_SETTINGS: SiteSettings = {
  title: "BIBO Bay", description: "Mindful songs, stories and playful learning for little learners ages 2–6, with Tula, Bob and Lumi.", seo: SAFE_FALLBACK_CONTENT.seo,
  commerceEnabled: false, trackingEnabled: false, testimonialsEnabled: false,
  socialLinks: [{ platform: "youtube", url: BIBO_YOUTUBE_CHANNEL_URL, verified: true }],
  navigation: { links: [{ label: "Meet the friends", href: "#characters" }, { label: "Watch", href: "#episodes" }, { label: "Join the list", href: "#lead" }], primaryCta: subscribeOnYouTube, commerceLabel: "Shop" },
  footer: { text: "BIBO Bay: mindful content for little learners. Screen time is part of childhood. Let’s make it count.", legalLinks: [{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }], contactLabel: "Contact" },
};
export const SAFE_FALLBACK_LEGAL: LegalSettings = { privacy: [], terms: [], consentCopyVersion: "1" };
