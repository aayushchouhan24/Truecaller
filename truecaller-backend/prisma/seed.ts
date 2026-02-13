import { PrismaClient, SourceType, VerificationLevel } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Find or create the demo user ──────────────────────────────────────
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        phoneNumber: '+919876543210',
        name: 'Demo User',
        verificationLevel: VerificationLevel.OTP_VERIFIED,
        trustScore: 1.0,
      },
    });
  }
  const userId = user.id;
  console.log(`  User: ${user.name} (${user.phoneNumber})`);

  // ── Number Identities with Name Contributions ─────────────────────────
  const identities = [
    { phone: '+919999000001', name: 'Rahul Sharma', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000002', name: 'Priya Patel', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000003', name: 'Amit Kumar', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000004', name: 'Sneha Gupta', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000005', name: 'Vikram Singh', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000006', name: 'Neha Reddy', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000007', name: 'Arjun Nair', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000008', name: 'Kavita Joshi', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000009', name: 'Rohan Desai', source: SourceType.CONTACT_UPLOAD },
    { phone: '+919999000010', name: 'Anjali Mehta', source: SourceType.CONTACT_UPLOAD },
    { phone: '+918800111222', name: 'Flipkart Delivery', source: SourceType.MANUAL },
    { phone: '+918800111333', name: 'Amazon Support', source: SourceType.MANUAL },
    { phone: '+918800111444', name: 'Swiggy Order', source: SourceType.MANUAL },
    { phone: '+918800111555', name: 'Zomato Delivery', source: SourceType.MANUAL },
    { phone: '+918800111666', name: 'HDFC Bank', source: SourceType.MANUAL },
    { phone: '+918800111777', name: 'SBI Bank', source: SourceType.MANUAL },
    { phone: '+918800111888', name: 'Airtel Customer Care', source: SourceType.MANUAL },
    { phone: '+918800111999', name: 'Jio Network', source: SourceType.MANUAL },
  ];

  for (const id of identities) {
    const existing = await prisma.numberIdentity.findFirst({ where: { phoneNumber: id.phone } });
    if (!existing) {
      await prisma.numberIdentity.create({
        data: {
          phoneNumber: id.phone,
          resolvedName: id.name,
          confidence: 0.8,
          sourceCount: 1,
          lastResolvedAt: new Date(),
          contributions: {
            create: {
              rawName: id.name,
              cleanedName: id.name,
              sourceType: id.source,
              contributorId: userId,
              contributorTrustWeight: 1.0,
            },
          },
          clusters: {
            create: {
              representativeName: id.name,
              variants: [id.name],
              totalWeight: 1.0,
              frequency: 1,
            },
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
