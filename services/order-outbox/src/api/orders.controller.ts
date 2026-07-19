import { Body, Controller, Get, NotFoundException, Param, Post, UseInterceptors } from "@nestjs/common";
import { ResponseInterceptor } from "@paikpaik/node-forge/response/nestjs";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrdersService } from "./orders.service";
import type { OrderView } from "./orders.service";

@Controller("orders")
@UseInterceptors(ResponseInterceptor)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto): Promise<{ id: string }> {
    return this.ordersService.create(dto);
  }

  @Get()
  findAll(): Promise<OrderView[]> {
    return this.ordersService.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string): Promise<OrderView> {
    const order = await this.ordersService.findOne(id);
    if (!order) throw new NotFoundException(`주문을 찾을 수 없습니다: ${id}`);
    return order;
  }
}
