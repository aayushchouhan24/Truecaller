import { Module, Global } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

const serviceAccountPath = path.join(
  process.cwd(),
  'firebase-service-account.json',
);

// Initialize Firebase Admin
if (!admin.apps.length) {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, 'utf8'),
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Fallback: use GOOGLE_APPLICATION_CREDENTIALS env var or default credentials
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: 'FIREBASE_ADMIN',
      useValue: admin,
    },
  ],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
