/**
 * Indian Name Reference Data
 *
 * Provides probabilistic lookup sets for Indian first names, last names,
 * middle names, prefixes, relationship terms, and descriptor terms.
 *
 * These are used as PROBABILISTIC SIGNALS (score boosters/penalties)
 * in the token classifier — not hard rules. A token matching a first name
 * gets a boost to NAME_LIKELY, but can still be overridden by frequency data.
 *
 * HYBRID ARCHITECTURE:
 * - Hardcoded SEED sets provide baseline coverage
 * - DB-backed LEARNED sets grow automatically as the system processes more data
 * - loadFromDatabase() merges DB entries with seeds at startup/refresh
 * - learnToken() adds new tokens discovered with high confidence
 */

// ── Seed Data (baseline — never removed) ───────────────────────────

const SEED_FIRST_NAMES = new Set([
  'abhishek', 'aman', 'harsh', 'ayush', 'aditi', 'anjali', 'shubham',
  'anushka', 'rohit', 'saurabh', 'muskan', 'rahul', 'utkarsh', 'vaibhav',
  'amit', 'saumya', 'rishabh', 'shruti', 'himanshu', 'kajal', 'ankit',
  'gaurav', 'nikhil', 'siddharth', 'prashant', 'priya', 'harshit',
  'shashank', 'akash', 'varun', 'yash', 'shreya', 'harshita', 'anurag',
  'vivek', 'swati', 'vishal', 'aditya', 'nidhi', 'ayushi', 'krishna',
  'anshika', 'sakshi', 'shivani', 'prakhar', 'mansi', 'tushar', 'abhinav',
  'shivangi', 'ashutosh', 'adarsh', 'divya', 'piyush', 'pragya', 'ajay',
  'akanksha', 'neeraj', 'ritika', 'tanya', 'nisha', 'arun', 'pallavi',
  'aniket', 'nikita', 'vijay', 'ananya', 'priyanshi', 'suraj', 'akshat',
  'ishika', 'mohit', 'palak', 'ankur', 'richa', 'ravi', 'arpit', 'ankita',
  'shraddha', 'deepak', 'priyanka', 'khushi', 'shweta', 'kavya', 'kunal',
  'dheeraj', 'akshita', 'riya', 'sneha', 'pranjal', 'isha', 'sumit',
  'kishan', 'pawan', 'soumya', 'neelesh', 'sarthak', 'alok', 'raghav',
  'rishi', 'pragati', 'shivam', 'lakshya', 'ashish', 'sandeep', 'ishita',
  'shaurya', 'kashish', 'vineet', 'mayank', 'jyoti', 'parul', 'shambhavi',
  'anshu', 'keshav', 'prince', 'prakash', 'pratibha', 'praveen',
  'priyanshu', 'kshitij', 'arushi', 'ishan', 'garima', 'manish',
  'vaishnavi', 'shreyansh', 'atul', 'sarvesh', 'vidya', 'shubhangi',
  'mohsin', 'saran', 'vikash', 'aayush', 'akhilesh', 'nitin', 'himani',
  'sushil', 'vartika', 'aviral', 'abdul', 'sumeet', 'prerna', 'nupur',
  'neha', 'vikas', 'vanshika', 'rohan', 'shivansh', 'sunil', 'juhi',
  'nitesh', 'ganesh', 'naveen', 'shikhar', 'jitendra', 'chirag', 'abhay',
  'lucky', 'smriti', 'manu', 'deependra', 'anoop', 'devendra', 'diksha',
  'muskaan', 'divyansh', 'kushal', 'nitish', 'preeti', 'anand', 'hemant',
  'amol', 'sonal', 'rishab', 'shashwat', 'shatakshi', 'supriya', 'anchal',
  'simran', 'srijan', 'ashwani', 'stuti', 'abhijeet', 'harshvardhan',
  'ajit', 'poornima', 'anil', 'mahendra', 'ahmad', 'shalini', 'abhijit',
  'suyash', 'sanskriti', 'danish', 'tamanna', 'unnati', 'sachin', 'anupam',
  'shailesh', 'shoaib', 'vishnu', 'surya', 'pankaj', 'kaif', 'pooja',
  'gayathri', 'pradeep', 'ritu', 'dinesh', 'shriya', 'tharun', 'karan',
  'kiran', 'tarun', 'samarth', 'ruchi', 'udit', 'rashi', 'shailendra',
  'sameer', 'shubhi', 'siddhant', 'mahi', 'kanika', 'aishwarya', 'rajat',
  'rituraj', 'naman', 'mukesh', 'roshan', 'nandini', 'rashmi', 'kriti',
  'arpita', 'divyanshi', 'yogesh', 'deepika', 'astha', 'sanjay', 'mahek',
  'narendra', 'ekta', 'adil', 'ritesh', 'bhumika', 'samriddhi', 'anmol',
  'aayushi', 'akshay', 'shekhar', 'amisha', 'amrita', 'sekhar', 'durga',
  'apurva', 'alka', 'navneet', 'om', 'swapnil', 'akhil', 'madhav',
  'divyam', 'kirti', 'annanya', 'arunima', 'sandhya', 'uttam', 'aparna',
  'disha', 'seema', 'suryansh', 'avinash', 'smita', 'aakash', 'ayan',
  'aryan', 'geeta', 'divyanshu', 'shrestha', 'shivanshi', 'shubh',
  'shreyash', 'satyam', 'shilpa', 'shikha', 'tanay', 'sushant', 'ujjwal',
  'tanu', 'subham', 'srishti', 'sudhanshu', 'shivang', 'shilpi', 'sourabh',
  'sonu', 'shakti', 'manya', 'pakhi', 'purvi', 'sapna', 'saloni', 'prachi',
  'poonam', 'purnima', 'prajjwal', 'vandana', 'tanishq', 'amaan', 'yuvraj',
  'saurav', 'sanjeev', 'simaran', 'shrishti', 'amrit', 'arman', 'archana',
  'yusuf', 'anubhav', 'anita', 'kritika', 'jaya', 'namrata', 'kushagra',
  'hariom', 'gargi', 'janvi', 'jai', 'ragini', 'priyam', 'nimish',
  'prateek', 'prarthana', 'rekha', 'pratham', 'devanshu', 'devansh',
  'dolly', 'dhruv', 'deeksha', 'bhavya', 'dev', 'deepali', 'faizan',
  'khushboo', 'karishma', 'madhuri', 'kartik', 'kartikeya', 'chaitanya',
  'sourav', 'ram', 'laxmi', 'krishan', 'vinay', 'rakesh', 'pushkar',
  'monica', 'sahil', 'kapil', 'raunak', 'tejas', 'mayur', 'mahesh',
  'aaryan', 'manas', 'surbhi', 'amar', 'anuj', 'farhan', 'nishant',
  'aaditya', 'ali', 'pranav', 'arnav', 'tanvi', 'sagar', 'sushmita',
  'rajveer', 'dhairya', 'radhika', 'puneet', 'hitesh', 'sankalp', 'gauri',
  'vedant', 'vedansh', 'manav', 'kabir', 'laksh', 'mehul', 'payal',
  'tanisha', 'trisha', 'pihu', 'angel', 'honey', 'kush', 'lalit',
  'lokesh', 'manoj', 'mohan', 'mukul', 'naren', 'naresh', 'paras',
  'parth', 'rajesh', 'rakhi', 'ramesh', 'rana', 'ranjit', 'rupesh',
  'sarita', 'satish', 'savita', 'seenu', 'shanti', 'sita', 'subhash',
  'sudhir', 'suresh', 'usha', 'uma', 'vimal', 'yamini', 'zoya',
]);

const SEED_LAST_NAMES = new Set([
  'singh', 'gupta', 'kumar', 'yadav', 'pandey', 'mishra', 'srivastava',
  'agarwal', 'sharma', 'verma', 'jaiswal', 'tiwari', 'jain', 'rai',
  'tripathi', 'khan', 'shukla', 'agrawal', 'dubey', 'rastogi', 'patel',
  'maurya', 'reddy', 'saxena', 'kumari', 'chaudhary', 'rathore', 'gautam',
  'pal', 'soni', 'dixit', 'pathak', 'meena', 'upadhyay', 'sinha',
  'mehrotra', 'dwivedi', 'kushwaha', 'raj', 'aggarwal', 'arora', 'saini',
  'vishwakarma', 'chaurasia', 'tandon', 'alam', 'sahu', 'bisht',
  'chaturvedi', 'bhardwaj', 'goyal', 'tomar', 'chauhan', 'patil', 'ojha',
  'kashyap', 'garg', 'choudhary', 'mehra', 'kaur', 'nigam', 'bhatia',
  'rawat', 'mehta', 'roy', 'bhatt', 'trivedi', 'shah', 'rizvi', 'negi',
  'pant', 'gurnani', 'khanna', 'singhal', 'ansari', 'vaish', 'bajpai',
  'prasad', 'baranwal', 'kapoor', 'dutta', 'panghal', 'chaudhari',
  'mustafa', 'barnwal', 'mathur', 'kesarwani', 'rajput', 'prajapati',
  'deshmukh', 'chavan', 'misra', 'kaushik', 'khandelwal', 'mittal', 'giri',
  'goswami', 'narayan', 'nayak', 'maheshwari', 'chaubey', 'rao', 'raza',
  'sachan', 'varma', 'arya', 'thakur', 'porwal', 'awasthi', 'agrahari',
  'bansal', 'anwar', 'gurjar', 'jha', 'varshney', 'bhatnagar', 'shinde',
  'tyagi', 'bharadwaj', 'chopra', 'shrivastava', 'ahuja', 'chawla', 'seth',
  'ranjan', 'malik', 'poddar', 'nath', 'upreti', 'srivastav', 'shekhar',
  'siraj', 'choubey', 'chandel', 'dikshit', 'malhotra', 'goel', 'chahal',
  'gill', 'chouhan', 'solanki', 'bhushan', 'pradhan', 'parashar',
  'malviya', 'pareek', 'meghwal', 'sen', 'sengar', 'sah', 'barman',
  'bais', 'shrivastav', 'kalra', 'chowdhury', 'bhalla', 'lamba', 'talwar',
  'mukherjee', 'baghel', 'khare', 'kukreja', 'gangwar', 'gaikwad',
  'kamble', 'vashisth', 'solanki', 'singhania', 'tewari', 'kothari',
  'sonkar', 'randhawa', 'priyadarshi', 'prabhu', 'sood', 'naqvi',
  'bhadauria', 'taneja', 'swain', 'nair', 'mitra', 'paul', 'menon',
  'shenoy', 'varghese', 'puri', 'sehgal', 'saraswat', 'kulkarni',
  'jadhav', 'ghosh', 'das', 'devi', 'dhaka', 'gehlot', 'ganguly',
  'hajira', 'iqbal', 'james', 'joseph', 'jose', 'joy', 'panu',
  'mahajan', 'nagraj', 'mukhopadhyay', 'nandakumar', 'shankar',
  'sundar', 'bhattacharya', 'bhattacharjee', 'chakraborty', 'iyer',
  'nambiar', 'pillai', 'kurup', 'warrier', 'menon', 'panicker',
]);

const SEED_MIDDLE_NAMES = new Set([
  'kumar', 'singh', 'pratap', 'raj', 'vikram', 'kumari', 'chandra',
  'reddy', 'deep', 'vardhan', 'prakash', 'ranjan', 'mani', 'shikha',
  'nath', 'shekhar', 'kishore', 'kannan', 'govind', 'pal', 'mahadev',
  'mohammed', 'narayan', 'husain', 'rani', 'haider', 'shankar', 'sai',
  'kiran', 'krishna', 'ramdas', 'ramesh', 'sunil', 'suresh', 'satya',
  'shrikant', 'sankar', 'vasant', 'yogesh', 'samrat', 'arun', 'teja',
  'subhash', 'ajit', 'anand', 'ji', 'preet', 'bala', 'bhanu', 'ratan',
  'santosh', 'mohan', 'prasad', 'gopal', 'chand', 'gopinath', 'jayant',
  'dinkarrao', 'lal', 'babu',
]);

const SEED_PREFIXES = new Set([
  'mohd', 'syed', 'mohammad', 'mohammed', 'km', 'md', 'kumari', 'sri',
  'muhammad', 'khwaja', 'raza', 'sir', 'shaikh', 'sai', 'shiv', 'sahab',
  'shree', 'sheikh', 'sayyed', 'mohamed', 'sree', 'mr', 'mrs', 'ms',
  'dr', 'prof', 'er', 'ca', 'adv', 'advocate', 'pandit', 'pt',
  'maulana', 'haji', 'swami',
]);

const SEED_RELATIONSHIP_TERMS = new Set([
  'bhaiya', 'bhai', 'bhau', 'bro', 'brother',
  'papa', 'daddy', 'abbu', 'abu', 'appa', 'baba', 'pitaji',
  'chacha', 'tau', 'tauji', 'dada', 'nana', 'nanu',
  'jija', 'jiju', 'sala', 'devar', 'jeth',
  'beta', 'babu', 'baccha', 'chhotu', 'munna',
  'phupaji', 'phupha', 'fufa', 'fufaji', 'mausa', 'mausaji',
  'sasur', 'sasurji',
  'didi', 'di', 'sis', 'sister', 'behen', 'behenji',
  'mummy', 'mama', 'maa', 'ma', 'ammi', 'amma', 'akka',
  'chachi', 'tai', 'taiji', 'dadi', 'nani',
  'bhabi', 'bhabhi', 'bhabhiji',
  'beti', 'bitiya', 'gudiya', 'munni',
  'bua', 'buaji', 'mausi', 'mausiji', 'massi', 'massiji',
  'saas', 'saasji',
  'nanad', 'devrani', 'jethani', 'saali',
  'uncle', 'aunty', 'auntie', 'aunt',
  'sir', 'madam', 'maam', 'sahab', 'sahib',
  'ji', 'jee', 'shri', 'shrimati', 'smt',
  'dost', 'yaar', 'friend', 'buddy',
  'anna', 'thatha', 'paati',
]);

const SEED_DESCRIPTOR_TERMS = new Set([
  'office', 'home', 'work', 'ghar', 'shop', 'dukan', 'store',
  'factory', 'godown', 'warehouse',
  'mobile', 'landline', 'whatsapp', 'call', 'phone', 'number', 'no',
  'personal', 'business', 'main', 'second', 'other',
  'new', 'old', 'purana', 'naya', 'pehla', 'doosra',
  'wala', 'wali', 'vale', 'ka', 'ki', 'ke', 'se', 'ko',
  'sir', 'miss', 'auto', 'taxi', 'cab',
  'delivery', 'courier', 'nearby', 'local', 'area',
  'colony', 'nagar', 'mohalla', 'sector', 'block', 'flat',
  'tower', 'floor', 'room',
]);

// ── Runtime Sets (seeds + learned) ─────────────────────────────────

const FIRST_NAMES = new Set(SEED_FIRST_NAMES);
const LAST_NAMES = new Set(SEED_LAST_NAMES);
const MIDDLE_NAMES = new Set(SEED_MIDDLE_NAMES);
const PREFIXES = new Set(SEED_PREFIXES);
const RELATIONSHIP_TERMS = new Set(SEED_RELATIONSHIP_TERMS);
const DESCRIPTOR_TERMS = new Set(SEED_DESCRIPTOR_TERMS);

let _loaded = false;

// ── DB Loading ─────────────────────────────────────────────────────

/**
 * Load name references from the database and merge with seed data.
 * Called at service startup and periodically to pick up newly learned tokens.
 */
export function loadFromDatabase(
  entries: { token: string; category: string }[],
): void {
  for (const e of entries) {
    const lower = e.token.toLowerCase();
    switch (e.category) {
      case 'FIRST_NAME':    FIRST_NAMES.add(lower); break;
      case 'LAST_NAME':     LAST_NAMES.add(lower); break;
      case 'MIDDLE_NAME':   MIDDLE_NAMES.add(lower); break;
      case 'PREFIX':        PREFIXES.add(lower); break;
      case 'RELATIONSHIP':  RELATIONSHIP_TERMS.add(lower); break;
      case 'DESCRIPTOR':    DESCRIPTOR_TERMS.add(lower); break;
    }
  }
  _loaded = true;
}

/** Check whether DB data has been loaded */
export function isLoaded(): boolean {
  return _loaded;
}

/** Get the current counts for monitoring */
export function getRefCounts(): Record<string, number> {
  return {
    firstNames: FIRST_NAMES.size,
    lastNames: LAST_NAMES.size,
    middleNames: MIDDLE_NAMES.size,
    prefixes: PREFIXES.size,
    relationships: RELATIONSHIP_TERMS.size,
    descriptors: DESCRIPTOR_TERMS.size,
  };
}

/**
 * Get all seed entries for initial DB seeding.
 */
export function getSeedEntries(): { token: string; category: string }[] {
  const entries: { token: string; category: string }[] = [];
  for (const t of SEED_FIRST_NAMES)       entries.push({ token: t, category: 'FIRST_NAME' });
  for (const t of SEED_LAST_NAMES)        entries.push({ token: t, category: 'LAST_NAME' });
  for (const t of SEED_MIDDLE_NAMES)      entries.push({ token: t, category: 'MIDDLE_NAME' });
  for (const t of SEED_PREFIXES)          entries.push({ token: t, category: 'PREFIX' });
  for (const t of SEED_RELATIONSHIP_TERMS) entries.push({ token: t, category: 'RELATIONSHIP' });
  for (const t of SEED_DESCRIPTOR_TERMS)  entries.push({ token: t, category: 'DESCRIPTOR' });
  return entries;
}

// ── Runtime Learning (adds to memory, caller persists to DB) ───────

export function learnToken(token: string, category: string): boolean {
  const lower = token.toLowerCase();
  if (lower.length < 2) return false;

  switch (category) {
    case 'FIRST_NAME':
      if (FIRST_NAMES.has(lower)) return false;
      FIRST_NAMES.add(lower);
      return true;
    case 'LAST_NAME':
      if (LAST_NAMES.has(lower)) return false;
      LAST_NAMES.add(lower);
      return true;
    case 'MIDDLE_NAME':
      if (MIDDLE_NAMES.has(lower)) return false;
      MIDDLE_NAMES.add(lower);
      return true;
    default:
      return false;
  }
}

// ── Public Lookup Functions ────────────────────────────────────────

export function isFirstName(token: string): boolean {
  return FIRST_NAMES.has(token.toLowerCase());
}

export function isLastName(token: string): boolean {
  return LAST_NAMES.has(token.toLowerCase());
}

export function isMiddleName(token: string): boolean {
  return MIDDLE_NAMES.has(token.toLowerCase());
}

export function isPrefix(token: string): boolean {
  return PREFIXES.has(token.toLowerCase());
}

export function isRelationshipTerm(token: string): boolean {
  return RELATIONSHIP_TERMS.has(token.toLowerCase());
}

export function isDescriptorTerm(token: string): boolean {
  return DESCRIPTOR_TERMS.has(token.toLowerCase());
}

/**
 * Check if token is any known name part (first, last, or middle).
 */
export function isKnownNamePart(token: string): boolean {
  const lower = token.toLowerCase();
  return FIRST_NAMES.has(lower) || LAST_NAMES.has(lower) || MIDDLE_NAMES.has(lower);
}

/**
 * Check if token is a known non-name term (relationship or descriptor).
 */
export function isNonNameTerm(token: string): boolean {
  const lower = token.toLowerCase();
  return RELATIONSHIP_TERMS.has(lower) || DESCRIPTOR_TERMS.has(lower);
}
