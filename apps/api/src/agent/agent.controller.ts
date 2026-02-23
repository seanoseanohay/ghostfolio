import { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AgentService } from './agent.service';
import { ChatRequestDto } from './dto/chat.dto';

@Controller('agent')
export class AgentController {
  public constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  public async chat(@Req() req: RequestWithUser, @Body() dto: ChatRequestDto) {
    try {
      return await this.agentService.chat({
        conversationId: dto.conversationId,
        query: dto.query,
        userId: req.user.id
      });
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Agent request failed',
          detail: (error as Error).message
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
