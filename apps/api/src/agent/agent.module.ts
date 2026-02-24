import { OrderModule } from '@ghostfolio/api/app/order/order.module';
import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';

import { Module } from '@nestjs/common';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  controllers: [AgentController],
  imports: [DataProviderModule, OrderModule, PortfolioModule],
  providers: [AgentService]
})
export class AgentModule {}
