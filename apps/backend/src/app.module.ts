import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { ContactsModule } from './contacts/contacts.module';
import { ContactTagsModule } from './contact-tags/contact-tags.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { NotesModule } from './notes/notes.module';
import { AiModule } from './ai/ai.module';
import { AuditModule } from './audit/audit.module';
import { StatsModule } from './stats/stats.module';
import { QuickRepliesModule } from './quick-replies/quick-replies.module';
import { SettingsModule } from './settings/settings.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { TemplatesModule } from './templates/templates.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { BotsModule } from './bots/bots.module';
import { MenuNodesModule } from './menu-nodes/menu-nodes.module';
import { ChannelAccessModule } from './common/services/channel-access.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    MailModule,
    ChannelAccessModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    EventsModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    WhatsAppModule,
    ContactsModule,
    ContactTagsModule,
    ConversationsModule,
    MessagesModule,
    NotesModule,
    AiModule,
    AuditModule,
    StatsModule,
    QuickRepliesModule,
    SettingsModule,
    SystemConfigModule,
    TemplatesModule,
    CampaignsModule,
    BotsModule,
    MenuNodesModule,
  ],
})
export class AppModule {}
