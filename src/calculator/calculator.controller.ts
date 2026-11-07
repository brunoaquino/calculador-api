import { applyDecorators, Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CalculatorService } from './calculator.service';
import { Operation } from './calculator.types';
import { OPERAND_DESCRIPTION, OperationQueryDto } from './dto/operation-query.dto';
import { OperationResultDto } from './dto/operation-result.dto';

function ApiOperands(termOneExample: string, termTwoExample: string) {
  return applyDecorators(
    ApiQuery({
      name: 'term_one',
      required: true,
      example: termOneExample,
      schema: { type: 'string' },
      description: OPERAND_DESCRIPTION,
    }),
    ApiQuery({
      name: 'term_two',
      required: true,
      example: termTwoExample,
      schema: { type: 'string' },
      description: OPERAND_DESCRIPTION,
    }),
    ApiOkResponse({ type: OperationResultDto }),
    ApiBadRequestResponse({
      type: ErrorResponseDto,
      description:
        'Invalid operands, division by zero, or a result that is not a finite number. These cases use HTTP 400.',
    }),
    ApiNotFoundResponse({ type: ErrorResponseDto }),
    ApiInternalServerErrorResponse({
      type: ErrorResponseDto,
      description: 'Unexpected failure. The message is generic and the stack is only logged.',
    }),
  );
}

@ApiTags('calculator')
@Controller()
export class CalculatorController {
  constructor(private readonly calculatorService: CalculatorService) {}

  @Get('sum')
  @ApiOperation({ operationId: 'sum', summary: 'Add term_one and term_two' })
  @ApiOperands('4', '1')
  sum(@Query() query: OperationQueryDto): OperationResultDto {
    return this.compute(Operation.Sum, query);
  }

  @Get('sub')
  @ApiOperation({ operationId: 'sub', summary: 'Subtract term_two from term_one' })
  @ApiOperands('4', '1')
  sub(@Query() query: OperationQueryDto): OperationResultDto {
    return this.compute(Operation.Sub, query);
  }

  @Get('mul')
  @ApiOperation({ operationId: 'mul', summary: 'Multiply term_one by term_two' })
  @ApiOperands('3', '5')
  mul(@Query() query: OperationQueryDto): OperationResultDto {
    return this.compute(Operation.Mul, query);
  }

  @Get('div')
  @ApiOperation({
    operationId: 'div',
    summary: 'Divide term_one by term_two',
    description:
      'Returns term_one / term_two. 5 divided by 2 is 2.5. Division by zero responds with HTTP 400.',
  })
  @ApiOperands('5', '2')
  div(@Query() query: OperationQueryDto): OperationResultDto {
    return this.compute(Operation.Div, query);
  }

  private compute(operation: Operation, query: OperationQueryDto): OperationResultDto {
    return {
      result: this.calculatorService.calculate(operation, query.term_one, query.term_two),
    };
  }
}
