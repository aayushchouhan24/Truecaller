import { PrismaClient, CallType, MessageCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Find or create the demo user ──────────────────────────────────────
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: { phoneNumber: '+919876543210', name: 'Demo User' },
    });
  }
  const userId = user.id;
  console.log(`  User: ${user.name} (${user.phoneNumber})`);

  // ── Number Identities (known callers) ─────────────────────────────────
  const identities = [
    { phone: '+919999000001', name: 'Rahul Sharma', source: 'MANUAL' as const },
    { phone: '+919999000002', name: 'Priya Patel', source: 'MANUAL' as const },
    { phone: '+919999000003', name: 'Amit Kumar', source: 'MANUAL' as const },
    { phone: '+919999000004', name: 'Sneha Gupta', source: 'MANUAL' as const },
    { phone: '+919999000005', name: 'Vikram Singh', source: 'MANUAL' as const },
    { phone: '+919999000006', name: 'Neha Reddy', source: 'MANUAL' as const },
    { phone: '+919999000007', name: 'Arjun Nair', source: 'MANUAL' as const },
    { phone: '+919999000008', name: 'Kavita Joshi', source: 'MANUAL' as const },
    { phone: '+919999000009', name: 'Rohan Desai', source: 'MANUAL' as const },
    { phone: '+919999000010', name: 'Anjali Mehta', source: 'MANUAL' as const },
    { phone: '+918800111222', name: 'Flipkart Delivery', source: 'VERIFIED' as const },
    { phone: '+918800111333', name: 'Amazon Support', source: 'VERIFIED' as const },
    { phone: '+918800111444', name: 'Swiggy Order', source: 'VERIFIED' as const },
    { phone: '+918800111555', name: 'Zomato Delivery', source: 'VERIFIED' as const },
    { phone: '+918800111666', name: 'HDFC Bank', source: 'VERIFIED' as const },
    { phone: '+918800111777', name: 'SBI Bank', source: 'VERIFIED' as const },
    { phone: '+918800111888', name: 'Airtel Customer Care', source: 'VERIFIED' as const },
    { phone: '+918800111999', name: 'Jio Network', source: 'VERIFIED' as const },
  ];

  for (const id of identities) {
    const existing = await prisma.numberIdentity.findFirst({ where: { phoneNumber: id.phone } });
    if (!existing) {
      await prisma.numberIdentity.create({
        data: {
          phoneNumber: id.phone,
          nameSignals: {
            create: { name: id.name, sourceType: id.source, weight: id.source === 'VERIFIED' ? 5.0 : 1.0 },
          },
        },
      });
    }
  }
  console.log(`  ${identities.length} number identities processed`);

  // ── Spam Numbers & Reports ────────────────────────────────────────────
  const spamNumbers = [
    { phone: '+917700000001', reason: 'Loan scam call', score: 85 },
    { phone: '+917700000002', reason: 'Insurance fraud', score: 72 },
    { phone: '+917700000003', reason: 'Credit card scam', score: 91 },
    { phone: '+917700000004', reason: 'KYC fraud call', score: 68 },
    { phone: '+917700000005', reason: 'Lottery scam', score: 95 },
    { phone: '+917700000006', reason: 'Investment fraud', score: 78 },
    { phone: '+917700000007', reason: 'Telemarketing spam', score: 55 },
    { phone: '+917700000008', reason: 'OTP fraud attempt', score: 88 },
    { phone: '+917700000009', reason: 'Fake delivery scam', score: 80 },
    { phone: '+917700000010', reason: 'UPI fraud call', score: 93 },
    { phone: '+917700000011', reason: 'Job scam', score: 65 },
    { phone: '+917700000012', reason: 'Real estate spam', score: 42 },
  ];

  for (const spam of spamNumbers) {
    const existing = await prisma.spamReport.findFirst({ where: { reporterId: userId, phoneNumber: spam.phone } });
    if (!existing) {
      await prisma.spamReport.create({
        data: { reporterId: userId, phoneNumber: spam.phone, reason: spam.reason },
      });
    }

    await prisma.spamScore.upsert({
      where: { phoneNumber: spam.phone },
      update: { score: spam.score },
      create: { phoneNumber: spam.phone, score: spam.score },
    });
  }

  // Spam number identities
  const spamIdentityNames = [
    { phone: '+917700000001', name: 'Suspected Loan Scam' },
    { phone: '+917700000002', name: 'Insurance Telemarketer' },
    { phone: '+917700000003', name: 'Credit Card Fraud' },
    { phone: '+917700000004', name: 'Fake KYC Call' },
    { phone: '+917700000005', name: 'Lottery Scam' },
    { phone: '+917700000006', name: 'Investment Scam' },
    { phone: '+917700000007', name: 'Telemarketing' },
    { phone: '+917700000008', name: 'OTP Fraud' },
    { phone: '+917700000009', name: 'Fake Delivery' },
    { phone: '+917700000010', name: 'UPI Fraud' },
    { phone: '+917700000011', name: 'Job Scam' },
    { phone: '+917700000012', name: 'Real Estate Spam' },
  ];

  for (const si of spamIdentityNames) {
    const existing = await prisma.numberIdentity.findFirst({ where: { phoneNumber: si.phone } });
    if (!existing) {
      await prisma.numberIdentity.create({
        data: {
          phoneNumber: si.phone,
          nameSignals: { create: { name: si.name, sourceType: 'MANUAL', weight: 1.0 } },
        },
      });
    }
  }
  console.log(`  ${spamNumbers.length} spam numbers reported`);

  // ── User Contacts ─────────────────────────────────────────────────────
  const contacts = [
    { phone: '+919999000001', name: 'Rahul Sharma' },
    { phone: '+919999000002', name: 'Priya Patel' },
    { phone: '+919999000003', name: 'Amit Kumar' },
    { phone: '+919999000004', name: 'Sneha Gupta' },
    { phone: '+919999000005', name: 'Vikram Singh' },
    { phone: '+919999000006', name: 'Neha Reddy' },
    { phone: '+919999000007', name: 'Arjun Nair' },
    { phone: '+919999000008', name: 'Kavita Joshi' },
    { phone: '+919999000009', name: 'Rohan Desai' },
    { phone: '+919999000010', name: 'Anjali Mehta' },
  ];

  for (const c of contacts) {
    await prisma.userContact.upsert({
      where: { userId_phoneNumber: { userId, phoneNumber: c.phone } },
      update: { name: c.name },
      create: { userId, phoneNumber: c.phone, name: c.name },
    });
  }
  console.log(`  ${contacts.length} contacts synced`);

  // ── Call History ──────────────────────────────────────────────────────
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

  const callData = [
    { phone: '+919999000001', name: 'Rahul Sharma', type: CallType.INCOMING, duration: 245, sim: 1, createdAt: hoursAgo(0.5) },
    { phone: '+919999000002', name: 'Priya Patel', type: CallType.OUTGOING, duration: 180, sim: 1, createdAt: hoursAgo(1) },
    { phone: '+919999000003', name: 'Amit Kumar', type: CallType.MISSED, duration: 0, sim: 1, createdAt: hoursAgo(2) },
    { phone: '+917700000001', name: 'Suspected Loan Scam', type: CallType.INCOMING, duration: 5, sim: 1, createdAt: hoursAgo(3), isSpam: true, spamLabel: 'Spam · Loan scam' },
    { phone: '+919999000004', name: 'Sneha Gupta', type: CallType.INCOMING, duration: 420, sim: 2, createdAt: hoursAgo(4) },
    { phone: '+918800111222', name: 'Flipkart Delivery', type: CallType.INCOMING, duration: 60, sim: 1, createdAt: hoursAgo(5) },
    { phone: '+919999000005', name: 'Vikram Singh', type: CallType.OUTGOING, duration: 90, sim: 1, createdAt: hoursAgo(8) },
    { phone: '+917700000003', name: 'Credit Card Fraud', type: CallType.BLOCKED, duration: 0, sim: 1, createdAt: hoursAgo(10), isSpam: true, spamLabel: 'Spam · Credit card scam' },
    { phone: '+919999000006', name: 'Neha Reddy', type: CallType.MISSED, duration: 0, sim: 2, createdAt: hoursAgo(12) },
    { phone: '+918800111444', name: 'Swiggy Order', type: CallType.INCOMING, duration: 45, sim: 1, createdAt: hoursAgo(14) },
    { phone: '+919999000007', name: 'Arjun Nair', type: CallType.OUTGOING, duration: 300, sim: 1, createdAt: daysAgo(1) },
    { phone: '+919999000008', name: 'Kavita Joshi', type: CallType.INCOMING, duration: 150, sim: 1, createdAt: daysAgo(1) },
    { phone: '+917700000005', name: 'Lottery Scam', type: CallType.INCOMING, duration: 3, sim: 2, createdAt: daysAgo(1), isSpam: true, spamLabel: 'Spam · Lottery scam' },
    { phone: '+918800111666', name: 'HDFC Bank', type: CallType.INCOMING, duration: 120, sim: 1, createdAt: daysAgo(2) },
    { phone: '+919999000009', name: 'Rohan Desai', type: CallType.MISSED, duration: 0, sim: 1, createdAt: daysAgo(2) },
    { phone: '+919999000010', name: 'Anjali Mehta', type: CallType.OUTGOING, duration: 600, sim: 2, createdAt: daysAgo(3) },
    { phone: '+917700000010', name: 'UPI Fraud', type: CallType.BLOCKED, duration: 0, sim: 1, createdAt: daysAgo(3), isSpam: true, spamLabel: 'Spam · UPI fraud' },
    { phone: '+919999000001', name: 'Rahul Sharma', type: CallType.OUTGOING, duration: 180, sim: 1, createdAt: daysAgo(4) },
    { phone: '+918800111888', name: 'Airtel Customer Care', type: CallType.OUTGOING, duration: 480, sim: 1, createdAt: daysAgo(5) },
    { phone: '+919999000002', name: 'Priya Patel', type: CallType.INCOMING, duration: 330, sim: 1, createdAt: daysAgo(5) },
  ];

  await prisma.callHistory.deleteMany({ where: { userId } });
  for (const call of callData) {
    await prisma.callHistory.create({
      data: {
        userId,
        phoneNumber: call.phone,
        name: call.name,
        type: call.type,
        duration: call.duration,
        sim: call.sim,
        isSpam: call.isSpam ?? false,
        spamLabel: call.spamLabel ?? null,
        createdAt: call.createdAt,
      },
    });
  }
  console.log(`  ${callData.length} call history records created`);

  // ── Messages ──────────────────────────────────────────────────────────
  const messagesData = [
    { sender: 'HDFC Bank', body: 'Rs. 2,500.00 debited from a/c **1234 on 12-Feb. UPI Ref: 456789012345. If not done by you, call 18002026161.', category: MessageCategory.TRANSACTIONAL, createdAt: hoursAgo(0.3) },
    { sender: 'SBI Bank', body: 'Dear Customer, your a/c XXXX5678 is credited with Rs. 15,000.00 on 12-Feb-25. Avl bal: Rs. 42,350.00.', category: MessageCategory.TRANSACTIONAL, createdAt: hoursAgo(1) },
    { sender: 'Amazon', body: 'Your order #402-8891234-5567890 has been shipped! Track: amzn.in/d/abc123', category: MessageCategory.TRANSACTIONAL, createdAt: hoursAgo(2) },
    { sender: 'VM-JIOMRT', body: 'Your Jio recharge of Rs.299 is successful. Validity: 28 days. Data: 2GB/day. Unlimited calls.', category: MessageCategory.TRANSACTIONAL, createdAt: hoursAgo(5) },
    { sender: '+917700000001', body: 'Congratulations! You have won Rs. 50,00,000 in our lucky draw. Send your bank details to claim. REF: XX1234', category: MessageCategory.SPAM, isSpam: true, createdAt: hoursAgo(3) },
    { sender: '+917700000008', body: 'Your OTP for account verification is 847291. Do NOT share this with anyone. This OTP is valid for 5 minutes.', category: MessageCategory.OTP, createdAt: hoursAgo(4) },
    { sender: 'Flipkart', body: 'MEGA SALE! Up to 80% OFF on electronics, fashion & more. Shop now: fkrt.it/xyz123. Use code MEGA80', category: MessageCategory.PROMOTIONAL, createdAt: hoursAgo(6) },
    { sender: 'Myntra', body: 'Happy Birthday! Get FLAT 40% OFF on your birthday with code BDAY40. Valid today only! myntra.com/sale', category: MessageCategory.PROMOTIONAL, createdAt: hoursAgo(8) },
    { sender: 'Rahul Sharma', body: 'Hey, are we still meeting for dinner tonight at 8?', category: MessageCategory.PERSONAL, createdAt: hoursAgo(1.5) },
    { sender: 'Priya Patel', body: 'Can you share the project report? Need it for tomorrow\'s meeting.', category: MessageCategory.PERSONAL, createdAt: hoursAgo(3) },
    { sender: 'Google', body: 'Your verification code is 482910. It expires in 10 minutes. Don\'t share it with anyone.', category: MessageCategory.OTP, createdAt: hoursAgo(4) },
    { sender: 'Paytm', body: 'Rs. 500 cashback credited to your Paytm wallet! Check balance: paytm.me/wallet', category: MessageCategory.TRANSACTIONAL, createdAt: hoursAgo(7) },
    { sender: '+917700000005', body: 'Dear Sir/Madam, your PAN card has been blocked. Update KYC immediately by clicking: bit.ly/fake-kyc', category: MessageCategory.SPAM, isSpam: true, createdAt: daysAgo(1) },
    { sender: 'IRCTC', body: 'PNR: 4521678901, Train: 12301 Rajdhani, 12-Feb, Coach: A1, Berth: 23, Confirmed. Happy Journey!', category: MessageCategory.TRANSACTIONAL, createdAt: daysAgo(1) },
    { sender: 'Uber', body: 'Your ride is arriving in 3 min. Driver: Suresh (4.8), White Swift Dzire, DL 01 AB 1234', category: MessageCategory.TRANSACTIONAL, createdAt: daysAgo(1) },
    { sender: 'Zomato', body: 'Craving something? Get 60% OFF up to Rs.120 on your next order! Code: ZOMATO60. Order now!', category: MessageCategory.PROMOTIONAL, createdAt: daysAgo(2) },
    { sender: 'Amit Kumar', body: 'Thanks for the help yesterday, really appreciated it!', category: MessageCategory.PERSONAL, createdAt: daysAgo(2) },
    { sender: 'Sneha Gupta', body: 'The photos from the trip are amazing! Shared them in the group.', category: MessageCategory.PERSONAL, createdAt: daysAgo(3) },
    { sender: '+917700000010', body: 'URGENT: Your bank account will be closed in 24 hours. Click here to verify: scam-link.com/verify', category: MessageCategory.SPAM, isSpam: true, createdAt: daysAgo(3) },
    { sender: 'PhonePe', body: 'You received Rs. 1,200.00 from Vikram Singh via UPI. Check your bank balance.', category: MessageCategory.TRANSACTIONAL, createdAt: daysAgo(4) },
  ];

  await prisma.message.deleteMany({ where: { userId } });
  for (const msg of messagesData) {
    await prisma.message.create({
      data: {
        userId,
        sender: msg.sender,
        body: msg.body,
        category: msg.category,
        isSpam: msg.isSpam ?? false,
        isRead: Math.random() > 0.5,
        createdAt: msg.createdAt,
      },
    });
  }
  console.log(`  ${messagesData.length} messages created`);

  // ── Search History ────────────────────────────────────────────────────
  const searches = [
    { query: 'Rahul Sharma', phoneNumber: '+919999000001', resultName: 'Rahul Sharma', createdAt: hoursAgo(2) },
    { query: '+917700000001', phoneNumber: '+917700000001', resultName: 'Suspected Loan Scam', createdAt: hoursAgo(5) },
    { query: 'HDFC Bank', phoneNumber: '+918800111666', resultName: 'HDFC Bank', createdAt: daysAgo(1) },
    { query: '+918800111444', phoneNumber: '+918800111444', resultName: 'Swiggy Order', createdAt: daysAgo(2) },
    { query: 'Priya', phoneNumber: '+919999000002', resultName: 'Priya Patel', createdAt: daysAgo(3) },
  ];

  await prisma.searchHistory.deleteMany({ where: { userId } });
  for (const s of searches) {
    await prisma.searchHistory.create({
      data: { userId, query: s.query, phoneNumber: s.phoneNumber, resultName: s.resultName, createdAt: s.createdAt },
    });
  }
  console.log(`  ${searches.length} search history entries created`);

  // ── Favorites ─────────────────────────────────────────────────────────
  const favs = [
    { phone: '+919999000001', name: 'Rahul Sharma' },
    { phone: '+919999000002', name: 'Priya Patel' },
    { phone: '+919999000004', name: 'Sneha Gupta' },
    { phone: '+919999000007', name: 'Arjun Nair' },
  ];

  for (const f of favs) {
    await prisma.favorite.upsert({
      where: { userId_phoneNumber: { userId, phoneNumber: f.phone } },
      update: { name: f.name },
      create: { userId, phoneNumber: f.phone, name: f.name },
    });
  }
  console.log(`  ${favs.length} favorites added`);

  console.log('✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
