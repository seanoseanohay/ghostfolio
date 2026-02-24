import { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
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

  @Get('conversations')
  @UseGuards(AuthGuard('jwt'))
  public async getConversations(@Req() req: RequestWithUser) {
    return this.agentService.getConversations(req.user.id);
  }

  @Get('conversations/:id')
  @UseGuards(AuthGuard('jwt'))
  public async getConversation(
    @Req() req: RequestWithUser,
    @Param('id') id: string
  ) {
    try {
      return await this.agentService.getConversation(req.user.id, id);
    } catch (error) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Conversation not found'
        },
        HttpStatus.NOT_FOUND
      );
    }
  }
}
