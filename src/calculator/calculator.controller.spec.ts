import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';
import { Operation } from './calculator.types';
import { OperationQueryDto } from './dto/operation-query.dto';

describe('CalculatorController', () => {
  const calculate = jest.fn();
  const controller = new CalculatorController({
    calculate,
  } as unknown as CalculatorService);

  it.each([
    ['sum', Operation.Sum, 1, 2, 3],
    ['sub', Operation.Sub, 4, 1, 3],
    ['mul', Operation.Mul, 3, 5, 15],
    ['div', Operation.Div, 5, 2, 2.5],
  ] as const)('%s delegates %s', (method, operation, termOne, termTwo, result) => {
    calculate.mockReturnValue(result);
    const query = { term_one: termOne, term_two: termTwo } as OperationQueryDto;
    const response =
      method === 'sum'
        ? controller.sum(query)
        : method === 'sub'
          ? controller.sub(query)
          : method === 'mul'
            ? controller.mul(query)
            : controller.div(query);

    expect(calculate).toHaveBeenCalledWith(operation, termOne, termTwo);
    expect(response).toEqual({ result });
  });
});
