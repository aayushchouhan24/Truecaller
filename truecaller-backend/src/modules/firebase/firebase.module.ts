import { Module, Global, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

const logger = new Logger('FirebaseModule');

// Initialize Firebase Admin — three credential sources in priority order:
//   1. FIREBASE_SERVICE_ACCOUNT env var  (base64-encoded JSON — for Docker/cloud)
//   2. firebase-service-account.json file on disk   (local dev)
//   3. applicationDefault()             (GCP workload identity — last resort)
if (!admin.apps.length) {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const serviceAccountPath = path.join(
    process.cwd(),
    'firebase-service-account.json',
  );

  if (envJson) {
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(envJson, 'base64').toString('utf8'),
      );
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      logger.log(`Firebase Admin initialised from env var (project: ${serviceAccount.project_id})`);
    } catch (e) {
      logger.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env var', e);
      throw e;
    }
  } else if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, 'utf8'),
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
    logger.log(`Firebase Admin initialised from file (project: ${serviceAccount.project_id})`);
  } else {
    // Last resort: GCP workload identity / GOOGLE_APPLICATION_CREDENTIALS
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    logger.warn('Firebase Admin using applicationDefault() — ensure credentials are available');
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
