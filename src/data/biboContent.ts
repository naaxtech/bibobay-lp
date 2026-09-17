export interface BayCharacter {
  id: string;
  name: string;
  species: string;
  role: string;
  color: string;
  accentColor: string;
  catchphrase: string;
  teaches: string[];
  personality: string;
  favoriteActivity: string;
  avatarEmoji: string;
}

export interface ShowEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  characterFocus: string;
  duration: string;
  summary: string;
  learningFocus: {
    earlySkills: string;
    values: string;
    earthCare: string;
  };
  screenOffSpark: string;
}

export interface UpcomingExtension {
  id: string;
  title: string;
  tagline: string;
  description: string;
  status: 'Coming Soon' | 'In Development';
  icon: string;
}

export interface TestimonialItem {
  id: string;
  author: string;
  role: string;
  avatar: string;
  quote: string;
}

export const CHARACTERS: BayCharacter[] = [
  {
    id: 'ollie-otter',
    name: 'Ollie the Sea Otter',
    species: 'Sea Otter',
    role: 'The Curious Heart',
    color: '#92400E',
    accentColor: '#FDE68A',
    catchphrase: '“Hold my paw, let’s see what we can find!”',
    teaches: ['Sharing & Turn-Taking', 'Everyday Problem Solving', 'Curiosity'],
    personality: 'Warm, cuddly, and endlessly curious. Ollie carries a little pink shell close to his chest and always notices when a friend looks a bit lonely.',
    favoriteActivity: 'Floating on his back building pebble towers with friends.',
    avatarEmoji: '🦦',
  },
  {
    id: 'wally-whale-shark',
    name: 'Wally the Whale Shark',
    species: 'Whale Shark',
    role: 'The Gentle Giant',
    color: '#0284C7',
    accentColor: '#BAE6FD',
    catchphrase: '“Breathe in the calm tide, breathe out the big storm.”',
    teaches: ['Counting & Numbers (1–20)', 'Deep Breathing & Calming Down', 'Patience'],
    personality: 'Big, peaceful, and spotted like starry night water. When feelings get too fast or loud, Wally helps everyone take three deep, slow belly breaths.',
    favoriteActivity: 'Gliding gently across the bay counting floating bubbles.',
    avatarEmoji: '🦈',
  },
  {
    id: 'shelly-turtle',
    name: 'Shelly the Sea Turtle',
    species: 'Green Sea Turtle',
    role: 'The Planet Guardian',
    color: '#15803D',
    accentColor: '#BBF7D0',
    catchphrase: '“Our reef takes care of us, so we take care of our reef.”',
    teaches: ['Caring for Nature', 'Cleaning Up Together', 'Patience & Wonder'],
    personality: 'Wise, steady, and full of sunshine. Shelly swims along the shoreline picking up drifted bottles and reminding us that small flippers can do big good.',
    favoriteActivity: 'Tending the colorful seagrass meadow and counting starfish.',
    avatarEmoji: '🐢',
  },
  {
    id: 'pip-squid',
    name: 'Pip the Little Squid',
    species: 'Lavender Squid',
    role: 'The Rhyme & Word Explorer',
    color: '#7C3AED',
    accentColor: '#DDD6FE',
    catchphrase: '“A is for Anemone, B is for Bay, C is for Caring!”',
    teaches: ['The Alphabet & Phonics', 'Colors & Shapes', 'Bouncing Back When Stuck'],
    personality: 'Playful, soft lavender, and full of fun songs. Sometimes Pip’s tentacles get tangled when trying something new, but she giggles and tries again.',
    favoriteActivity: 'Singing the Bay ABC rhyme with clapping fins.',
    avatarEmoji: '🦑',
  },
  {
    id: 'finny-clownfish',
    name: 'Finny the Clownfish',
    species: 'Clownfish',
    role: 'The Joyful Neighbor',
    color: '#EA580C',
    accentColor: '#FFEDD5',
    catchphrase: '“There’s always room for one more friend on the coral!”',
    teaches: ['Inclusion & Making Friends', 'Honest Apologies', 'Empathy'],
    personality: 'Bouncy orange and white stripes with the biggest heart in the bay. Finny is quick to say "I\'m sorry" when he bumps someone and loves welcoming new pals.',
    favoriteActivity: 'Playing gentle coral tag and sharing snacks.',
    avatarEmoji: '🐠',
  },
  {
    id: 'pearl-clam',
    name: 'Pearl in the Shell',
    species: 'Little Oyster & Pearl',
    role: 'The Quiet Wisdom',
    color: '#0F766E',
    accentColor: '#CCFBF1',
    catchphrase: '“It’s okay to be quiet. Your feelings are special inside.”',
    teaches: ['Naming Shy & Big Feelings', 'Bedtime Calm', 'Self-Worth'],
    personality: 'A sweet, smiling pearl cozy inside her scallop shell. Pearl reminds little ones that you don’t have to be the loudest voice in the room to be loved and heard.',
    favoriteActivity: 'Listening to bedtime ocean waves and soft lullabies.',
    avatarEmoji: '🦪',
  },
];

export const SHOW_EPISODES: ShowEpisode[] = [
  {
    id: 'ep-1',
    episodeNumber: 1,
    title: 'The Lost Alphabet Coral',
    characterFocus: 'Pip the Squid & Ollie',
    duration: '11 mins',
    summary: 'When a strong current sweeps away Pip’s letter stones, the bay friends work together to find letters A through Z hidden in the coral garden.',
    learningFocus: {
      earlySkills: 'Letter recognition, phonetic sounds (A-B-C), and sequencing.',
      values: 'Teamwork, asking for help, and celebrating each other’s discoveries.',
      earthCare: 'Leaving living coral untouched while searching for lost items.',
    },
    screenOffSpark: 'Look around your living room: can you find one object that starts with the first letter of your name?',
  },
  {
    id: 'ep-2',
    episodeNumber: 2,
    title: 'Wally’s Big Count & Calm Breath',
    characterFocus: 'Wally the Whale Shark & Finny',
    duration: '12 mins',
    summary: 'Finny gets frustrated when his seashell tower falls over. Wally teaches him how to count 10 slow ocean breaths to cool down his stormy tummy.',
    learningFocus: {
      earlySkills: 'Counting forward 1 to 10 with rhythmic visual cues.',
      values: 'Self-regulation, managing frustration, and trying again without tears.',
      earthCare: 'Learning how gentle sea currents naturally smooth beach stones.',
    },
    screenOffSpark: 'Place your favorite stuffed toy on your tummy. Breathe in to make it rise like a boat, breathe out to let it dock!',
  },
  {
    id: 'ep-3',
    episodeNumber: 3,
    title: 'Shelly’s Great Shoreline Clean-Up',
    characterFocus: 'Shelly the Turtle & Pearl',
    duration: '11 mins',
    summary: 'A stray plastic wrapper drifts into Pearl’s lagoon. Shelly rallies the Bay crew to make the water sparkling clean again.',
    learningFocus: {
      earlySkills: 'Sorting by material, color matching, and counting collected items.',
      values: 'Community care, personal responsibility, and pride in our spaces.',
      earthCare: 'Understanding how plastics harm sea friends and how recycling helps.',
    },
    screenOffSpark: 'Do a 2-minute "Tidy Tide" in your bedroom: pick up 5 toys and put them back in their safe homes.',
  },
];

export const UPCOMING_EXTENSIONS: UpcomingExtension[] = [
  {
    id: 'bibo-academy',
    title: 'BIBO Academy',
    tagline: 'Guided learning pathways',
    description: 'Bite-sized developmental guides and printable milestone booklets created with early childhood educators to support counting, phonics, and emotional literacy at home.',
    status: 'Coming Soon',
    icon: 'BookOpen',
  },
  {
    id: 'bibo-lab',
    title: 'BIBO Lab',
    tagline: 'Kitchen counter STEM',
    description: 'Safe, low-prep experiments parents and kids can do with tap water, spoons, and backyard leaves—exploring the science behind the show.',
    status: 'Coming Soon',
    icon: 'FlaskConical',
  },
  {
    id: 'bibo-makes-toys',
    title: 'BIBO Toys & Makes',
    tagline: 'Plastic-free, durable play',
    description: 'Thoughtfully crafted plush friends and heirloom wooden activity sets with zero single-use plastic packaging. Real toys designed to be kept and passed down.',
    status: 'Coming Soon',
    icon: 'Package',
  },
];

export const TESTIMONIALS: TestimonialItem[] = [
  {
    id: 't1',
    author: 'Dr. Elena Vance, PsyD',
    role: 'Pediatric Neuropsychologist & Mother of Two',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    quote: 'The visual pace of BIBO Bay is a breath of fresh air. It avoids the rapid dopaminergic flashes that leave young children overstimulated and irritable. My patients’ parents see an immediate difference at bedtime.',
  },
  {
    id: 't2',
    author: 'Marcus Chen',
    role: 'Pre-K Educator & Dad of a 4-Year-Old',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    quote: 'My daughter asks for Wally the Whale Shark every afternoon. When the episode ends, she doesn’t cry—she runs to her bedroom to do the counting and breathing games from the show. It’s the first show I genuinely trust.',
  },
  {
    id: 't3',
    author: 'Sarah Jenkins',
    role: 'Parent of 3 & Environmental Science Teacher',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    quote: 'Shelly the Turtle taught my five-year-old why we pick up plastics at the beach without making him feel anxious about the world. It’s full of hope, gentle humor, and real warmth.',
  },
];

export const PARENT_FAQS = [
  {
    question: 'When does BIBO Bay release, and where can we watch it?',
    answer: 'BIBO Bay Season 1 is currently in production for release on major family streaming platforms and ad-free digital access. Founding Families will receive exclusive private screening links to the pilot episodes before the public premiere.',
  },
  {
    question: 'What ages is BIBO Bay best suited for?',
    answer: 'BIBO Bay is lovingly crafted for children ages 2 to 7. Toddlers fall in love with the cuddly plush characters and cheerful sing-alongs, while preschoolers and early elementary kids absorb the counting, phonics, problem-solving, and emotional coping tools.',
  },
  {
    question: 'Why do you emphasize "gentle pacing"?',
    answer: 'Modern research from child psychologists shows that rapid scene changes (cuts every 1.5–2 seconds) and loud, chaotic sound effects overwhelm a child’s developing nervous system. BIBO Bay is deliberately paced with breathable pauses, allowing children to process what they see and transition smoothly into bedtime or dinner without meltdowns.',
  },
  {
    question: 'What is the Free 28-Page Family Starter Kit?',
    answer: 'It’s our warm welcome gift for parents who join our Founding Families circle! It includes printable coloring sheets of Ollie, Wally, and the crew, an Emotion Check-in Chart you can hang on the fridge, 5 easy weekend kitchen experiments, and an 8-minute audio bedtime story.',
  },
  {
    question: 'Are there advertisements or sponsored product placements?',
    answer: 'Never. BIBO Bay is 100% ad-free and commercial-free. We believe early childhood is sacred, and children should never be treated as targets for advertisers.',
  },
];
