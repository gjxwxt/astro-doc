// 传入图标、title、description、color、link、tag
// tag类型分为
// 展示站点的组件
import "../styles/website.css";
import "../styles/right_menu.css";
import { useEffect, useRef, useState } from "react";
import { IoMdAdd, IoIosCreate } from "react-icons/io";
import { IoSettingsOutline } from "react-icons/io5";
import { MdDeleteForever } from "react-icons/md";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// 请求接口，返回该网站相关信息，格式为data:{name: xxx, icon: [xxx],}
// https://api.codelife.cc/website/info?lang=cn&url=
const getWebsiteInfo = async (url) => {
  const res = await fetch(
    `https://api.codelife.cc/website/info?lang=cn&url=http://www.bilibili.com/`,
    // `https://api.codelife.cc/website/info?lang=cn&url=${url}`,
    {
      method: "GET",
      credentials: "include",
      referrerPolicy: "no-referrer",
      redirect: "follow",
      headers: {
        Mode: "production",
      },
    }
  );
  const data = await res.json();
  return data;
};

export default ({ tag, defaultList }) => {
  const [iconList, setIconList] = useState();
  const [editItem, setEditItem] = useState();
  const appGroupItem = useRef(null);
  const menu = useRef(null);
  const addNewMenu = useRef(null);
  const addNewDialog = useRef(null);

  function getInputValue() {
    const valueList = addNewDialog.current.querySelectorAll("input");
    const name = valueList[0].value;
    const url = valueList[1].value;
    const backgroundColor = valueList[2].value;
    const src = valueList[3].value;
    return { name, url, backgroundColor, src };
  }

  function addIconList() {
    const { name, url, backgroundColor, src } = getInputValue();
    const randomColor = "#" + Math.floor(Math.random() * 0xffffff).toString(16);
    // 生成一个随机的id
    const id = Math.random().toString(36).slice(2);
    // 如果没有title或者link，直接返回
    if (!name || !url) {
      return;
    }
    // 如果没有iconUrl，请求接口获取
    // if (!iconUrl) {
    // getWebsiteInfo(link).then((data) => {
    //   setIconList([
    //     ...iconList,
    //     { title, link, iconUrl: data?.icon[0], color: color || randomColor },
    //   ]);
    // });
    // }
    // 如果是编辑状态，替换原有的数据
    if (editItem) {
      const newIconList = iconList.map((item) => {
        if (item.id === editItem.id) {
          return {
            id,
            name,
            url,
            src,
            backgroundColor: backgroundColor || randomColor,
          };
        }
        return item;
      });
      setIconList(newIconList);
    } else {
      // 添加新的数据
      setIconList([
        ...iconList,
        { id, name, url, src, backgroundColor: backgroundColor || randomColor },
      ]);
    }
    addNewDialog.current.style.display = "none";
  }

  function showMenu(e) {
    e.preventDefault();
    // 查询所有的弹窗，如果有添加弹窗在页面上了，就不展示右键菜单
    let isShow = false;
    document.querySelectorAll(".dialog-addNewIcon")?.forEach((item) => {
      if (item.style.display === "block") {
        isShow = true;
      }
    });
    if (isShow) {
      return false;
    }
    document.querySelectorAll(".menu-rightClick")?.forEach((item) => {
      item.style.display = "none";
    });
    if (addNewDialog.current.style.display === "block") {
      return false;
    } // 如果添加网站的弹窗打开，不展示右键菜单
    menu.current.style.display = "block";
    menu.current.style.left = e.clientX + "px";
    menu.current.style.top = e.clientY + "px";
    return false;
  }

  function editAppItem(item) {
    setEditItem(item);
  }

  function deleteAppItem() {
    // 先弹出确认框，确认后再删除
    const newIconList = iconList.filter((item) => item.id !== editItem.id);
    setIconList(newIconList);
    setEditItem(null);
  }

  function showAddAppDialog(e) {
    e.stopPropagation();
    addNewDialog.current.style.display = "block";
    menu.current.style.display = "none";
  }

  function closeMenuAndDialog() {
    menu.current.style.display = "none";
    addNewDialog.current.style.display = "none";
    setEditItem(null);
  }

  useEffect(() => {
    document.addEventListener(
      "click",
      () => {
        menu.current.style.display = "none";
        addNewDialog.current.style.display = "none";
        setEditItem(null);
      },
      false
    );

    const localData = localStorage.getItem(tag + "iconList");
    if (localData && JSON.parse(localData)?.length) {
      setIconList(JSON.parse(localData));
    } else {
      setIconList(defaultList);
    }
  }, []);

  // 监听iconList, 保存到本地
  useEffect(() => {
    if (!iconList) {
      return;
    }
    localStorage.setItem(tag + "iconList", JSON.stringify(iconList));
  }, [iconList]);

  // 监听editItem, 如果有值，展示添加网站的弹窗
  useEffect(() => {
    const dialog = addNewDialog.current.querySelector(
      ".dialog-addNewIcon_content"
    );
    if (dialog) {
      dialog.querySelector("#title").value = editItem?.name || "";
      dialog.querySelector("#link").value = editItem?.url || "";
      dialog.querySelector("#color").value =
        editItem?.backgroundColor || "#00a1b3";
      dialog.querySelector("#iconUrl").value = editItem?.src || "";
    }
  }, [editItem]);

  return (
    <div
      ref={appGroupItem}
      onContextMenu={showMenu}
      onClick={closeMenuAndDialog}
      className="app-group"
    >
      <ul className="website">
        {iconList &&
          iconList.map((item) => {
            return (
              <li
                className="app-item"
                key={item.id}
                onContextMenu={() => editAppItem(item)}
              >
                <div
                  className="app-item-icon"
                  title={item.description || item.name}
                  onClick={() => {
                    window.open(item.url);
                  }}
                  style={{
                    backgroundColor: item.backgroundColor || "#00a1b3",
                  }}
                >
                  {item.src && <img className="app-item-img" src={item.src} />}
                  {!item.src && (
                    <div
                      className="app-item-img"
                      style={{
                        backgroundColor: item.backgroundColor || "#00a1b3",
                      }}
                    >
                      <span className="d-text-txt">{item.name}</span>
                    </div>
                  )}
                </div>
                <p className="app-item-title">{item.name}</p>
              </li>
            );
          })}
      </ul>

      <div className="menu-rightClick" ref={menu}>
        <div>
          <span>{tag}</span>
        </div>
        <ul id="menuBox">
          {!editItem && (
            <li id="addNewIcon" ref={addNewMenu} onClick={showAddAppDialog}>
              <span>添加网站</span>
              <span>
                <IoMdAdd />
              </span>
            </li>
          )}
          {editItem && (
            <>
              <li id="editAppItem" onClick={showAddAppDialog}>
                <span>编辑</span>
                <span>
                  <IoIosCreate />
                </span>
              </li>
              <li id="deleteAppItem" onClick={deleteAppItem}>
                <span>删除</span>
                <span>
                  <MdDeleteForever />
                </span>
              </li>
            </>
          )}
          <li>
            <span>设置</span>
            <span>
              <IoSettingsOutline />
            </span>
          </li>
        </ul>
      </div>
      <div
        className="dialog-addNewIcon"
        ref={addNewDialog}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-addNewIcon_content">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              type="text"
              id="title"
              placeholder="title"
              style={{ margin: "5px 0" }}
            />
          </div>
          <div>
            <Label htmlFor="link">Link</Label>
            <Input
              type="text"
              id="link"
              placeholder="Link"
              style={{ margin: "5px 0" }}
            />
          </div>
          <div>
            <Label htmlFor="color">Color</Label>
            <Input
              type="color"
              id="color"
              placeholder="Color"
              style={{ margin: "5px 0" }}
            />
          </div>
          <div>
            <Label htmlFor="iconUrl">图标地址</Label>
            <Input
              type="text"
              id="iconUrl"
              placeholder="IconUrl"
              style={{ margin: "5px 0" }}
            />
          </div>
        </div>
        <div className="dialog-addNewIcon_submit">
          <button onClickCapture={addIconList}>保存</button>
        </div>
      </div>
    </div>
  );
};
