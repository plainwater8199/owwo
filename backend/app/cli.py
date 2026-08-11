"""管理员 CLI:手动创建用户。

本系统不开放注册,管理员手动创建是用户准入的唯一入口(见 ADR-0001、
CONTEXT.md 的「管理员」)。

用法:
    python -m app.cli create-user <用户名>
"""
import typer

from app.users import UsernameExists, create_user

cli = typer.Typer(add_completion=False)


@cli.callback()
def _main() -> None:
    """owwo 管理员 CLI:手动创建用户等管理员操作(不开放注册,见 ADR-0001)。"""


@cli.command("create-user")
def create_user_cmd(
    username: str = typer.Argument(..., help="新用户的用户名"),
) -> None:
    """管理员手动创建一个用户。"""
    password = typer.prompt("密码", hide_input=True, confirmation_prompt=True)
    try:
        user = create_user(username, password)
    except UsernameExists:
        typer.secho(f"用户 '{username}' 已存在", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    typer.secho(f"已创建用户 '{user.username}'", fg=typer.colors.GREEN)


if __name__ == "__main__":
    cli()
